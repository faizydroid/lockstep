/**
 * Equivocation detection.
 *
 * The registry can prove equivocation but cannot notice it: nothing on chain scans
 * for two conflicting claims about one version. That is what this does, and it is
 * why slashing is permissionless — anyone running this can collect the reward, so
 * the offence stays expensive without a privileged operator.
 *
 * Pure detection logic, separated from RPC and signing so it can be tested without
 * a node.
 */

import type { Address, Hex } from "viem";

export interface PublishedPin {
  readonly pinId: Hex;
  readonly publisher: Address;
  readonly skillHash: Hex;
  readonly versionId: Hex;
  readonly publishedAt: bigint;
  readonly requiredBond: bigint;
  readonly slashed: boolean;
  readonly bondReclaimed: boolean;
}

export interface EquivocationProof {
  readonly publisher: Address;
  readonly versionId: Hex;
  /** The earlier claim. Users approved against this one. */
  readonly firstPinId: Hex;
  /** The later, contradicting claim. Its bond is the one at stake. */
  readonly guiltyPinId: Hex;
  /** Bond recoverable by slashing, in bond-asset units. */
  readonly bondAtStake: bigint;
}

const key = (publisher: Address, versionId: Hex): string =>
  `${publisher.toLowerCase()}:${versionId.toLowerCase()}`;

/**
 * Finds every provable equivocation in a set of pins.
 *
 * A proof needs two pins from one publisher that share a `versionId` and differ in
 * `skillHash`. Where a publisher has made three or more conflicting claims, each
 * later claim is separately slashable, so all pairs against the earliest claim are
 * returned rather than only the first.
 *
 * Already-slashed pins are excluded because their bond is gone; already-reclaimed
 * pins are excluded because the registry refuses to slash them. Filtering here
 * avoids burning gas on transactions that would revert.
 */
export function findEquivocations(pins: readonly PublishedPin[]): readonly EquivocationProof[] {
  const byVersion = new Map<string, PublishedPin[]>();

  for (const pin of pins) {
    const k = key(pin.publisher, pin.versionId);
    const list = byVersion.get(k);
    if (list === undefined) byVersion.set(k, [pin]);
    else list.push(pin);
  }

  const proofs: EquivocationProof[] = [];

  for (const group of byVersion.values()) {
    if (group.length < 2) continue;

    // Distinct byte sets only. Identical hashes under one version cannot happen via
    // `publish` (the pin id would collide) but the check keeps the proof standing on
    // its own rather than on an invariant elsewhere.
    const distinct = new Map<string, PublishedPin>();
    for (const pin of group) {
      const h = pin.skillHash.toLowerCase();
      const existing = distinct.get(h);
      if (existing === undefined || pin.publishedAt < existing.publishedAt) {
        distinct.set(h, pin);
      }
    }
    if (distinct.size < 2) continue;

    const ordered = [...distinct.values()].sort((a, b) =>
      a.publishedAt === b.publishedAt ? 0 : a.publishedAt < b.publishedAt ? -1 : 1,
    );
    const first = ordered[0]!;

    for (const guilty of ordered.slice(1)) {
      if (guilty.slashed || guilty.bondReclaimed) continue;
      proofs.push({
        publisher: guilty.publisher,
        versionId: guilty.versionId,
        firstPinId: first.pinId,
        guiltyPinId: guilty.pinId,
        bondAtStake: guilty.requiredBond,
      });
    }
  }

  // Largest bond first: a watcher with limited gas should claim the most valuable
  // proof, and in a race the reward goes to whoever lands first.
  return proofs.sort((a, b) => (a.bondAtStake === b.bondAtStake ? 0 : a.bondAtStake > b.bondAtStake ? -1 : 1));
}

/**
 * Whether a proof is worth submitting at current gas prices.
 *
 * Without this the watcher will happily spend more on gas than the reward pays,
 * which turns permissionless enforcement into a slow donation.
 */
export function isProfitable(
  proof: EquivocationProof,
  options: {
    /** Challenger's share of the bond, in basis points. */
    readonly challengerRewardBps: bigint;
    /** Estimated gas cost of the slash transaction, in bond-asset units. */
    readonly estimatedCostInBondAsset: bigint;
    /** Minimum margin required, in bond-asset units. */
    readonly minMargin: bigint;
  },
): boolean {
  const reward = (proof.bondAtStake * options.challengerRewardBps) / 10_000n;
  return reward > options.estimatedCostInBondAsset + options.minMargin;
}
