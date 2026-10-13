/**
 * Finding a pin, and checking it against the manifest on disk, without scanning logs.
 *
 * `pins.ts` finds pins by replaying `Published` events from block zero. Monad's public RPC refuses
 * `eth_getLogs` over a hundred blocks, so on the chain this ships on, `approve`, `diff` and `status`
 * could not run at all: the one command whose output a person is supposed to read before they sign.
 *
 * A pin id is `keccak256(abi.encode(publisher, skillHash))`. A reader who says which publishers they
 * trust can compute every candidate pin for the bytes on disk and ask the registry about each: one
 * `eth_call` per publisher, no log read. That also changes what the command is. Scanning logs took
 * whichever pin was published first, by anyone, and showed no publisher at all, so a front-runner who
 * pinned the same public bytes with a wider capability set was the pin the user approved. Naming the
 * publisher is not an optimisation; it is the thing being decided.
 *
 * What the chain cannot tell a reader is *what* a pin allows: capabilities sit in a mapping that can
 * only be asked about one pair at a time. So the check goes the other way. The manifest in the skill
 * directory lists pairs; the registry is asked whether the pin allows each; and the pin's declared
 * count says whether it allows more than the manifest lists. Approval proceeds only when the two agree
 * exactly, because a pin that allows something the reader was not shown is not a pin they can approve.
 */
import { encodeAbiParameters, keccak256, type Address, type Hex, type PublicClient } from "viem";
import { getAddress, isAddress } from "viem";

import { lockstepGuardAbi, pinRegistryAbi } from "./abi.ts";
import type { Capability, Manifest } from "./manifest.ts";

/** What the registry holds about a pin. Capabilities are not here: see the header. */
export interface PinState {
  readonly pinId: Hex;
  readonly publisher: Address;
  readonly skillHash: Hex;
  readonly versionId: Hex;
  readonly maxValuePerBatch: bigint;
  /** Bond locked against this pin at publish time, in the bond asset's smallest unit. */
  readonly requiredBond: bigint;
  readonly capabilityCount: number;
  readonly highRiskCount: number;
  readonly publishedAt: bigint;
  readonly revoked: boolean;
  /** True once this pin's bond has been taken by a successful equivocation challenge. */
  readonly slashed: boolean;
}

/** Mirrors `PinRegistry.computePinId`. */
export function computePinId(publisher: Address, skillHash: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [publisher, skillHash]));
}

/** A pin the guard would still honour. Slashing revokes, but `slashed` is checked on its own as well. */
export function isLive(pin: PinState): boolean {
  return !pin.revoked && !pin.slashed;
}

export async function readPin(
  client: PublicClient,
  registry: Address,
  pinId: Hex,
): Promise<PinState | undefined> {
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
  return {
    pinId,
    publisher: pin.publisher,
    skillHash: pin.skillHash,
    versionId: pin.versionId,
    maxValuePerBatch: pin.maxValuePerBatch,
    requiredBond: pin.requiredBond,
    capabilityCount: Number(pin.capabilityCount),
    highRiskCount: Number(pin.highRiskCount),
    publishedAt: pin.publishedAt,
    revoked: pin.revokedAt !== 0n,
    slashed: pin.slashed,
  };
}

/** Pins these publishers hold for these exact bytes. One `eth_call` each, no logs. */
export async function pinsForPublishers(
  client: PublicClient,
  registry: Address,
  skillHash: Hex,
  publishers: readonly Address[],
): Promise<readonly PinState[]> {
  const unique = [...new Map(publishers.map((p) => [p.toLowerCase(), p])).values()];
  const pins = await Promise.all(unique.map((p) => readPin(client, registry, computePinId(p, skillHash))));
  return pins.filter((p): p is PinState => p !== undefined);
}

/**
 * Every pin anyone published for these bytes, found by replaying `Published` events.
 *
 * Works on a local chain and on an archive endpoint, and fails on Monad's public RPC. Kept for the first
 * two and refused by name for the third: see `isLogRangeRefusal`.
 */
export async function pinsFromLogs(
  client: PublicClient,
  registry: Address,
  skillHash: Hex,
  fromBlock: bigint | "earliest",
): Promise<readonly PinState[]> {
  const logs = await client.getContractEvents({
    address: registry,
    abi: pinRegistryAbi,
    eventName: "Published",
    args: { skillHash },
    fromBlock,
  });
  const ids = [...new Set(logs.map((l) => (l.args as { pinId?: Hex }).pinId).filter((x): x is Hex => x !== undefined))];
  const pins = await Promise.all(ids.map((id) => readPin(client, registry, id)));
  return pins.filter((p): p is PinState => p !== undefined);
}

/** True when an RPC refused a log query because of its range, which is how Monad's public endpoint answers. */
export function isLogRangeRefusal(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${(error as { details?: string }).details ?? ""}` : String(error);
  return /limited to a \d+ range|-32614|block range|range (is )?too (large|wide|big)|exceed(s|ed)? (the )?(max|maximum|limit)|query returned more than/i.test(
    text,
  );
}

/** Parses repeated and comma-separated addresses. Names the source in the error. */
export function parseAddressList(values: readonly string[], source: string): Address[] {
  const out: Address[] = [];
  for (const value of values) {
    for (const part of value.split(",")) {
      const trimmed = part.trim();
      if (trimmed === "") continue;
      if (!isAddress(trimmed, { strict: false })) {
        throw new Error(`${source}: ${JSON.stringify(trimmed.slice(0, 60))} is not a 20-byte address`);
      }
      out.push(getAddress(trimmed.toLowerCase()));
    }
  }
  return out;
}

export function parsePinId(value: string, source: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${source}: ${JSON.stringify(value.slice(0, 80))} is not a 32-byte pin id`);
  }
  return value.toLowerCase() as Hex;
}

// ---------------------------------------------------------------------------------------------------------------------
// Resolving which pin is meant
// ---------------------------------------------------------------------------------------------------------------------

export interface LookupOptions {
  /** Publishers the reader trusts. Pins are computed for these. */
  readonly publishers: readonly Address[];
  /** A specific pin, when the reader already knows which one is meant. */
  readonly pin: Hex | undefined;
  /** Where a log scan starts, for chains that allow one. */
  readonly fromBlock: bigint | "earliest";
}

export type Resolution =
  | { readonly kind: "found"; readonly pin: PinState; readonly via: "pin" | "publisher" | "logs" }
  /** Nothing is pinned for these bytes (by the publishers asked). */
  | { readonly kind: "none"; readonly searched: string }
  /** Pins exist but none is live. */
  | { readonly kind: "unusable"; readonly pins: readonly PinState[] }
  /** More than one live pin for the same bytes: the reader has to say whom they trust. */
  | { readonly kind: "ambiguous"; readonly pins: readonly PinState[]; readonly via: "publisher" | "logs" }
  /** `--pin` names a pin that commits to different bytes than the directory holds. */
  | { readonly kind: "mismatch"; readonly pin: PinState }
  /** No publisher was named and the RPC will not let us look for one. */
  | { readonly kind: "needs-publisher" };

export async function resolvePin(
  client: PublicClient,
  registry: Address,
  skillHash: Hex,
  options: LookupOptions,
): Promise<Resolution> {
  if (options.pin !== undefined) {
    const pin = await readPin(client, registry, options.pin);
    if (pin === undefined) return { kind: "none", searched: `pin ${options.pin}` };
    if (pin.skillHash.toLowerCase() !== skillHash.toLowerCase()) return { kind: "mismatch", pin };
    return isLive(pin) ? { kind: "found", pin, via: "pin" } : { kind: "unusable", pins: [pin] };
  }

  let pins: readonly PinState[];
  let via: "publisher" | "logs";
  let searched: string;
  if (options.publishers.length > 0) {
    via = "publisher";
    pins = await pinsForPublishers(client, registry, skillHash, options.publishers);
    searched = options.publishers.length === 1 ? `publisher ${options.publishers[0]}` : `${options.publishers.length} publishers`;
  } else {
    via = "logs";
    try {
      pins = await pinsFromLogs(client, registry, skillHash, options.fromBlock);
    } catch (error) {
      if (isLogRangeRefusal(error)) return { kind: "needs-publisher" };
      throw error;
    }
    searched = "the registry's logs";
  }

  if (pins.length === 0) return { kind: "none", searched };
  const live = pins.filter(isLive);
  if (live.length === 0) return { kind: "unusable", pins };
  if (live.length > 1) return { kind: "ambiguous", pins: live, via };
  return { kind: "found", pin: live[0]!, via };
}

// ---------------------------------------------------------------------------------------------------------------------
// Checking a pin against the manifest
// ---------------------------------------------------------------------------------------------------------------------

const pairKey = (c: Capability): string => `${c.target.toLowerCase()}:${c.selector.toLowerCase()}`;

/** The manifest's capabilities with duplicates removed, which is how the registry counts them. */
export function uniqueCapabilities(manifest: Manifest): readonly Capability[] {
  return [...new Map(manifest.capabilities.map((c) => [pairKey(c), c])).values()];
}

export interface ManifestCheck {
  /** Pairs the manifest lists that the pin allows. */
  readonly allowed: readonly Capability[];
  /** Pairs the manifest lists that the pin does NOT allow. */
  readonly notAllowed: readonly Capability[];
  /** How many more pairs the pin allows than the manifest lists. Anything above zero is unseen power. */
  readonly unlisted: number;
  readonly ceiling: { readonly manifest: bigint; readonly pin: bigint };
  /** True only when the manifest and the pin describe exactly the same capabilities and ceiling. */
  readonly matches: boolean;
}

export async function checkManifest(
  client: PublicClient,
  registry: Address,
  pin: PinState,
  manifest: Manifest,
): Promise<ManifestCheck> {
  const pairs = uniqueCapabilities(manifest);
  const flags = await Promise.all(
    pairs.map(
      (c) =>
        client.readContract({
          address: registry,
          abi: pinRegistryAbi,
          functionName: "isAllowed",
          args: [pin.pinId, c.target, c.selector],
        }) as Promise<boolean>,
    ),
  );
  const allowed = pairs.filter((_, i) => flags[i] === true);
  const notAllowed = pairs.filter((_, i) => flags[i] !== true);
  const unlisted = Math.max(0, pin.capabilityCount - allowed.length);
  const ceiling = { manifest: manifest.maxValuePerBatch, pin: pin.maxValuePerBatch };
  return {
    allowed,
    notAllowed,
    unlisted,
    ceiling,
    matches: notAllowed.length === 0 && unlisted === 0 && ceiling.manifest === ceiling.pin,
  };
}

export interface Change {
  /** Capabilities in the new version that the previous pin did not allow. */
  readonly added: readonly Capability[];
  readonly keptCount: number;
  /** Capabilities the previous pin allowed that the new one does not. Counted, not named: see the header. */
  readonly removedCount: number;
  readonly ceilingBefore: bigint;
  readonly ceilingAfter: bigint;
  /** True when the new version can do anything the previous one could not. */
  readonly widened: boolean;
}

/** What the new version adds to, or takes from, a pin the reader names as the baseline. */
export async function compareWithPrevious(
  client: PublicClient,
  registry: Address,
  previous: PinState,
  candidate: PinState,
  manifest: Manifest,
): Promise<Change> {
  const pairs = uniqueCapabilities(manifest);
  const flags = await Promise.all(
    pairs.map(
      (c) =>
        client.readContract({
          address: registry,
          abi: pinRegistryAbi,
          functionName: "isAllowed",
          args: [previous.pinId, c.target, c.selector],
        }) as Promise<boolean>,
    ),
  );
  const added = pairs.filter((_, i) => flags[i] !== true);
  const keptCount = pairs.length - added.length;
  const removedCount = Math.max(0, previous.capabilityCount - keptCount);
  const widened = added.length > 0 || candidate.maxValuePerBatch > previous.maxValuePerBatch;
  return {
    added,
    keptCount,
    removedCount,
    ceilingBefore: previous.maxValuePerBatch,
    ceilingAfter: candidate.maxValuePerBatch,
    widened,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The account
// ---------------------------------------------------------------------------------------------------------------------

export type ApprovalState = "approved" | "not-approved" | "not-delegated";

/** EIP-7702 delegation designator: `0xef0100` followed by the delegate's address. */
export function delegateOf(code: Hex | undefined): Address | undefined {
  if (code === undefined) return undefined;
  const lower = code.toLowerCase();
  if (lower.length !== 2 + 23 * 2 || !lower.startsWith("0xef0100")) return undefined;
  return getAddress(`0x${lower.slice(8)}`);
}

/**
 * Whether the account has approved a pin. An account that carries no delegation has nowhere to store an
 * approval, and asking it would fail with a decoding error rather than an answer, so that is checked first.
 */
export async function approvalState(client: PublicClient, account: Address, pinId: Hex): Promise<ApprovalState> {
  const code = await client.getCode({ address: account });
  if (delegateOf(code) === undefined) return "not-delegated";
  const approved = (await client.readContract({
    address: account,
    abi: lockstepGuardAbi,
    functionName: "isPinApproved",
    args: [pinId],
  })) as boolean;
  return approved ? "approved" : "not-approved";
}
