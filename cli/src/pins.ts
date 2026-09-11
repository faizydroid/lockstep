/**
 * Pin discovery and capability diffing.
 *
 * The diff is the heart of the approval UX. It decides how loudly a change is presented,
 * not whether it is presented: a rebuild that alters bytes but declares the same powers is
 * a cheap decision, while a version that adds `approve` on a token must stop and be read.
 * Getting that distinction right is what keeps the product from dying of permission
 * fatigue.
 *
 * `widened` used to decide whether the user was asked at all, and a capability-identical
 * rebuild was approved with no prompt. That is the quietest possible inheritance of
 * financial authority, which is the thing this product exists to prevent, so it now always
 * prompts. See `commands/approve.ts`.
 */

import type { Address, Hex, PublicClient } from "viem";

import { lockstepGuardAbi, pinRegistryAbi } from "./abi.ts";
import { HIGH_RISK_LABELS, isHighRiskSelector } from "./risk.ts";

export interface PinCapability {
  readonly target: Address;
  readonly selector: Hex;
  readonly highRisk: boolean;
}

export interface PinSummary {
  readonly pinId: Hex;
  readonly publisher: Address;
  readonly skillHash: Hex;
  /** keccak256 of the declared name and version. Two pins sharing one is equivocation. */
  readonly versionId: Hex;
  readonly maxValuePerBatch: bigint;
  /** Bond locked against this pin at publish time, in bond-asset units. */
  readonly requiredBond: bigint;
  readonly publishedAt: bigint;
  readonly revoked: boolean;
  /** True once this pin's bond has been taken by a successful equivocation challenge. */
  readonly slashed: boolean;
  readonly capabilities: readonly PinCapability[];
}

const capabilityKey = (c: PinCapability): string => `${c.target.toLowerCase()}:${c.selector}`;

/** Pins published for an exact skill hash. `skillHash` is an indexed event topic. */
export async function findPinsForSkillHash(
  client: PublicClient,
  registry: Address,
  skillHash: Hex,
): Promise<readonly PinSummary[]> {
  const logs = await client.getContractEvents({
    address: registry,
    abi: pinRegistryAbi,
    eventName: "Published",
    args: { skillHash },
    fromBlock: "earliest",
  });

  const summaries: PinSummary[] = [];
  for (const log of logs) {
    const pinId = (log.args as { pinId?: Hex }).pinId;
    if (pinId === undefined) continue;
    const summary = await loadPin(client, registry, pinId);
    if (summary !== undefined) summaries.push(summary);
  }
  return summaries;
}

export async function loadPin(
  client: PublicClient,
  registry: Address,
  pinId: Hex,
): Promise<PinSummary | undefined> {
  const pin = (await client.readContract({
    address: registry,
    abi: pinRegistryAbi,
    functionName: "getPin",
    args: [pinId],
  })) as {
    publisher: Address;
    skillHash: Hex;
    versionId: Hex;
    maxValuePerBatch: bigint;
    requiredBond: bigint;
    capabilityCount: number;
    highRiskCount: number;
    publishedAt: bigint;
    revokedAt: bigint;
    exists: boolean;
    slashed: boolean;
  };

  if (!pin.exists) return undefined;

  // Capabilities are only recoverable from events; the registry stores them in a
  // nested mapping that cannot be enumerated on chain. That is a deliberate
  // trade for a single-SLOAD hot path.
  const declared = await client.getContractEvents({
    address: registry,
    abi: pinRegistryAbi,
    eventName: "CapabilityDeclared",
    args: { pinId },
    fromBlock: "earliest",
  });

  const capabilities: PinCapability[] = [];
  for (const log of declared) {
    const args = log.args as { target?: Address; selector?: Hex; highRisk?: boolean };
    if (args.target === undefined || args.selector === undefined) continue;
    capabilities.push({
      target: args.target,
      selector: args.selector,
      highRisk: args.highRisk ?? isHighRiskSelector(args.selector),
    });
  }

  return {
    pinId,
    publisher: pin.publisher,
    skillHash: pin.skillHash,
    versionId: pin.versionId,
    maxValuePerBatch: pin.maxValuePerBatch,
    requiredBond: pin.requiredBond,
    publishedAt: pin.publishedAt,
    revoked: pin.revokedAt !== 0n,
    slashed: pin.slashed,
    capabilities,
  };
}

/** Pins the account has approved, replayed in block order so revocations win. */
export async function loadApprovedPinIds(
  client: PublicClient,
  account: Address,
): Promise<readonly Hex[]> {
  const [approved, unapproved] = await Promise.all([
    client.getContractEvents({
      address: account,
      abi: lockstepGuardAbi,
      eventName: "PinApproved",
      fromBlock: "earliest",
    }),
    client.getContractEvents({
      address: account,
      abi: lockstepGuardAbi,
      eventName: "PinUnapproved",
      fromBlock: "earliest",
    }),
  ]);

  const entries = [
    ...approved.map((l) => ({ l, on: true })),
    ...unapproved.map((l) => ({ l, on: false })),
  ].sort((a, b) => {
    const ab = a.l.blockNumber ?? 0n;
    const bb = b.l.blockNumber ?? 0n;
    if (ab !== bb) return ab < bb ? -1 : 1;
    return (a.l.logIndex ?? 0) - (b.l.logIndex ?? 0);
  });

  const live = new Set<Hex>();
  for (const entry of entries) {
    const pinId = (entry.l.args as { pinId?: Hex }).pinId;
    if (pinId === undefined) continue;
    if (entry.on) live.add(pinId);
    else live.delete(pinId);
  }
  return [...live];
}

export interface CapabilityDiff {
  readonly added: readonly PinCapability[];
  readonly removed: readonly PinCapability[];
  readonly unchanged: readonly PinCapability[];
  readonly valueCeilingBefore: bigint;
  readonly valueCeilingAfter: bigint;
  /** True when the new version can do anything the old one could not. */
  readonly widened: boolean;
}

export function diffCapabilities(before: PinSummary, after: PinSummary): CapabilityDiff {
  const beforeKeys = new Set(before.capabilities.map(capabilityKey));
  const afterKeys = new Set(after.capabilities.map(capabilityKey));

  const added = after.capabilities.filter((c) => !beforeKeys.has(capabilityKey(c)));
  const removed = before.capabilities.filter((c) => !afterKeys.has(capabilityKey(c)));
  const unchanged = after.capabilities.filter((c) => beforeKeys.has(capabilityKey(c)));

  // Widening is any new capability, or a higher native-value ceiling. Removing a
  // capability is a narrowing and does not require a fresh approval.
  const widened = added.length > 0 || after.maxValuePerBatch > before.maxValuePerBatch;

  return {
    added,
    removed,
    unchanged,
    valueCeilingBefore: before.maxValuePerBatch,
    valueCeilingAfter: after.maxValuePerBatch,
    widened,
  };
}

export function formatCapability(c: PinCapability): string {
  const risk = c.highRisk ? `  [HIGH RISK: ${HIGH_RISK_LABELS[c.selector] ?? "elevated"}]` : "";
  return `${c.target}  ${c.selector}${risk}`;
}
