/**
 * Finds provable equivocation in a set of pins.
 *
 * This is what makes the challenge button possible. `slashEquivocation(pinIdA, pinIdB)` is permissionless
 * and the registry verifies the evidence itself, but somebody has to notice the evidence exists — and
 * "permissionless" is worth nothing if spotting a violation requires writing a script.
 *
 * ## What counts
 *
 * A version id is `keccak256(name, version)`. Publishing two pins under one version id means claiming
 * that two different sets of bytes are both `swap-router@2.1.0`, which is a contradiction the publisher
 * cannot explain away. The registry's own rule, which this mirrors:
 *
 *   - same publisher, because pin ids are `keccak256(publisher, skillHash)` and two publishers using the
 *     same version string are not contradicting each other, they are just both shipping a `1.0.0`
 *   - same version id
 *   - different skill hashes, since one pin cannot conflict with itself
 *   - both still live, because a revoked claim has been withdrawn and a slashed one is already paid for
 *
 * ## Argument order matters
 *
 * The later pin is the guilty one. Users approved against the earlier claim, so the offence is the
 * contradiction introduced afterwards. Returning them in publish order makes the pair meaningful rather
 * than arbitrary, and it matches what the registry expects.
 */

import type { Hex } from "viem";

import type { Pin } from "./model";

export interface Equivocation {
  readonly publisher: Pin["publisher"];
  readonly versionId: Hex;
  /** Human name and version when a manifest was available. Never trusted for identity. */
  readonly skillName?: string;
  readonly skillVersion?: string;
  /** The earlier claim, which is what approvals were made against. */
  readonly original: Pin;
  /** The later, contradicting claim. */
  readonly conflicting: Pin;
  /** Bond at stake on the conflicting pin, which is what a challenger is paid out of. */
  readonly bondAtStake: bigint;
}

/** True when this pin can still vouch for a transaction. */
function isLive(pin: Pin): boolean {
  return pin.state === "bonded" || pin.state === "pinned";
}

export function findEquivocations(pins: readonly Pin[]): readonly Equivocation[] {
  const groups = new Map<string, Pin[]>();

  for (const pin of pins) {
    if (!isLive(pin)) continue;
    // Publisher AND version id. Keyed on lowercase because address casing is not guaranteed.
    const key = `${pin.publisher.toLowerCase()}:${pin.versionId.toLowerCase()}`;
    const list = groups.get(key) ?? [];
    list.push(pin);
    groups.set(key, list);
  }

  const found: Equivocation[] = [];

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    /*
     * Distinct hashes only.
     *
     * Two live pins with the same publisher, version id AND skill hash would be the same pin, which the
     * registry rejects at publish time with `AlreadyPublished`. Filtering anyway means a duplicated
     * fixture or a double-counted log cannot manufacture a false accusation, and a false challenge costs
     * a user gas.
     */
    const byHash = new Map<string, Pin>();
    for (const pin of group) {
      const h = pin.skillHash.toLowerCase();
      const existing = byHash.get(h);
      // Keep the earliest instance of a given hash, so ordering below stays meaningful.
      if (existing === undefined || pin.publishedAt < existing.publishedAt) byHash.set(h, pin);
    }
    if (byHash.size < 2) continue;

    const ordered = [...byHash.values()].sort((a, b) => Number(a.publishedAt - b.publishedAt));
    const original = ordered[0];
    const conflicting = ordered[1];
    if (original === undefined || conflicting === undefined) continue;

    found.push({
      publisher: original.publisher,
      versionId: original.versionId,
      original,
      conflicting,
      bondAtStake: conflicting.requiredBond,
      ...(original.skillName !== undefined ? { skillName: original.skillName } : {}),
      ...(original.skillVersion !== undefined ? { skillVersion: original.skillVersion } : {}),
    });
  }

  // Largest bond first: the most valuable challenge is the one worth surfacing.
  return found.sort((a, b) => (b.bondAtStake > a.bondAtStake ? 1 : b.bondAtStake < a.bondAtStake ? -1 : 0));
}

/**
 * What a challenger would earn, in bond-asset units.
 *
 * `challengerRewardBps` is 5,000 on the live registry, so half. Read from the chain rather than assumed,
 * because it is an immutable a different deployment could set differently.
 */
export function challengerReward(bondAtStake: bigint, challengerRewardBps: bigint): bigint {
  return (bondAtStake * challengerRewardBps) / 10_000n;
}
