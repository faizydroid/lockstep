/**
 * Equivocation detection, which decides when a challenge button appears.
 *
 * A false positive here costs a user real gas on a transaction the registry will revert, so the
 * negative cases carry more weight than the positive one. The four ways a pair can look like a
 * contradiction without being one -- different publishers, different version ids, a revoked claim, the
 * same pin twice -- each get a test.
 *
 * Ordering is also asserted, because the pair is not symmetric. The later pin is the guilty one: users
 * approved against the earlier claim, so the offence is the contradiction added afterwards.
 */

import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";

import { challengerReward, findEquivocations } from "@/lib/equivocation";
import type { Pin, PinState } from "@/lib/model";

const PUB_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const PUB_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
const VERSION_1 = `0x${"11".repeat(32)}` as Hex;
const VERSION_2 = `0x${"22".repeat(32)}` as Hex;

let seq = 0;

function pin(over: Partial<Pin> = {}): Pin {
  seq += 1;
  return {
    pinId: `0x${seq.toString(16).padStart(64, "0")}` as Hex,
    publisher: PUB_A,
    skillHash: `0x${seq.toString(16).padStart(64, "a")}` as Hex,
    versionId: VERSION_1,
    maxValuePerBatch: 0n,
    requiredBond: 125_000_000n,
    publishedAt: 1_772_000_000n + BigInt(seq),
    slashed: false,
    capabilities: [],
    state: "bonded" as PinState,
    ...over,
  };
}

describe("findEquivocations", () => {
  it("finds two live pins from one publisher under one version id", () => {
    const first = pin({ publishedAt: 100n, skillHash: `0x${"11".repeat(32)}` as Hex });
    const second = pin({ publishedAt: 200n, skillHash: `0x${"22".repeat(32)}` as Hex });

    const found = findEquivocations([first, second]);
    expect(found).toHaveLength(1);
    expect(found[0]?.publisher).toBe(PUB_A);
    expect(found[0]?.versionId).toBe(VERSION_1);
  });

  it("puts the earlier claim first and the contradiction second", () => {
    /*
     * Not cosmetic. Approvals were made against the earlier claim, so the later one is the offence, and
     * the pair is passed to the registry in that order.
     */
    const later = pin({ publishedAt: 900n, skillHash: `0x${"cc".repeat(32)}` as Hex });
    const earlier = pin({ publishedAt: 100n, skillHash: `0x${"dd".repeat(32)}` as Hex });

    // Deliberately supplied out of order.
    const found = findEquivocations([later, earlier]);
    expect(found[0]?.original.publishedAt).toBe(100n);
    expect(found[0]?.conflicting.publishedAt).toBe(900n);
  });

  it("reports the bond on the conflicting pin as what is at stake", () => {
    const earlier = pin({ publishedAt: 100n, requiredBond: 125_000_000n, skillHash: `0x${"1a".repeat(32)}` as Hex });
    const later = pin({ publishedAt: 200n, requiredBond: 1_625_000_000n, skillHash: `0x${"2a".repeat(32)}` as Hex });

    const found = findEquivocations([earlier, later]);
    expect(found[0]?.bondAtStake).toBe(1_625_000_000n);
  });

  it("ignores two publishers who happen to use the same version string", () => {
    // Both shipping a 1.0.0 is not a contradiction. Pin ids are keyed by publisher for this reason.
    const a = pin({ publisher: PUB_A, skillHash: `0x${"33".repeat(32)}` as Hex });
    const b = pin({ publisher: PUB_B, skillHash: `0x${"44".repeat(32)}` as Hex });

    expect(findEquivocations([a, b])).toHaveLength(0);
  });

  it("ignores one publisher shipping two different versions", () => {
    const a = pin({ versionId: VERSION_1, skillHash: `0x${"55".repeat(32)}` as Hex });
    const b = pin({ versionId: VERSION_2, skillHash: `0x${"66".repeat(32)}` as Hex });

    expect(findEquivocations([a, b])).toHaveLength(0);
  });

  it("ignores a pair where one claim was revoked", () => {
    // A withdrawn claim is not a live contradiction; the publisher took it back.
    const live = pin({ skillHash: `0x${"77".repeat(32)}` as Hex });
    const revoked = pin({ skillHash: `0x${"88".repeat(32)}` as Hex, state: "revoked", revokedAt: 500n });

    expect(findEquivocations([live, revoked])).toHaveLength(0);
  });

  it("ignores a publisher already slashed for it", () => {
    const live = pin({ skillHash: `0x${"99".repeat(32)}` as Hex });
    const done = pin({ skillHash: `0x${"9a".repeat(32)}` as Hex, state: "equivocated", slashed: true });

    expect(findEquivocations([live, done])).toHaveLength(0);
  });

  it("does not treat a duplicated pin as a contradiction", () => {
    /*
     * The registry rejects republishing the same hash with `AlreadyPublished`, so this pair cannot exist
     * on chain. It can exist in a snapshot if a log were double-counted, and a false challenge costs the
     * user gas, so it is filtered rather than trusted.
     */
    const hash = `0x${"ab".repeat(32)}` as Hex;
    const one = pin({ skillHash: hash, publishedAt: 100n });
    const same = pin({ skillHash: hash, publishedAt: 200n });

    expect(findEquivocations([one, same])).toHaveLength(0);
  });

  it("returns nothing for an empty or single-pin registry", () => {
    expect(findEquivocations([])).toHaveLength(0);
    expect(findEquivocations([pin()])).toHaveLength(0);
  });

  it("orders results by bond at stake, largest first", () => {
    const smallA = pin({ versionId: VERSION_1, publishedAt: 10n, requiredBond: 100n, skillHash: `0x${"01".repeat(32)}` as Hex });
    const smallB = pin({ versionId: VERSION_1, publishedAt: 20n, requiredBond: 200n, skillHash: `0x${"02".repeat(32)}` as Hex });
    const bigA = pin({ versionId: VERSION_2, publishedAt: 10n, requiredBond: 100n, skillHash: `0x${"03".repeat(32)}` as Hex });
    const bigB = pin({ versionId: VERSION_2, publishedAt: 20n, requiredBond: 9_000n, skillHash: `0x${"04".repeat(32)}` as Hex });

    const found = findEquivocations([smallA, smallB, bigA, bigB]);
    expect(found).toHaveLength(2);
    expect(found[0]?.bondAtStake).toBe(9_000n);
    expect(found[1]?.bondAtStake).toBe(200n);
  });

  it("is case-insensitive about addresses and hashes", () => {
    // eth_getCode and log decoding do not guarantee casing, so the grouping key must not depend on it.
    const a = pin({ publisher: PUB_A.toUpperCase().replace("0X", "0x") as Address, skillHash: `0x${"e1".repeat(32)}` as Hex });
    const b = pin({ publisher: PUB_A, skillHash: `0x${"e2".repeat(32)}` as Hex });

    expect(findEquivocations([a, b])).toHaveLength(1);
  });
});

describe("challengerReward", () => {
  it("pays half at 5000 bps, which is the live registry's setting", () => {
    expect(challengerReward(1_625_000_000n, 5_000n)).toBe(812_500_000n);
  });

  it("reads the rate rather than assuming half", () => {
    // A different deployment can set this differently; it is an immutable, not a constant of nature.
    expect(challengerReward(1_000n, 2_500n)).toBe(250n);
    expect(challengerReward(1_000n, 10_000n)).toBe(1_000n);
    expect(challengerReward(1_000n, 0n)).toBe(0n);
  });

  it("truncates rather than rounding, matching integer division on chain", () => {
    expect(challengerReward(3n, 5_000n)).toBe(1n);
  });
});
