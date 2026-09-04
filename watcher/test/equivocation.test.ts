import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";

import { findEquivocations, isProfitable, type PublishedPin } from "../src/equivocation.ts";

const PUB_A = "0x1111111111111111111111111111111111111111" as Address;
const PUB_B = "0x2222222222222222222222222222222222222222" as Address;

const V1 = `0x${"aa".repeat(32)}` as Hex;
const V2 = `0x${"bb".repeat(32)}` as Hex;

let counter = 0;
function pin(overrides: Partial<PublishedPin> = {}): PublishedPin {
  counter += 1;
  return {
    pinId: `0x${counter.toString(16).padStart(64, "0")}` as Hex,
    publisher: PUB_A,
    skillHash: `0x${counter.toString(16).padStart(2, "0").repeat(32)}` as Hex,
    versionId: V1,
    publishedAt: BigInt(counter),
    requiredBond: 125_000_000n,
    slashed: false,
    bondReclaimed: false,
    ...overrides,
  };
}

describe("findEquivocations", () => {
  it("finds nothing when every version has one claim", () => {
    const pins = [pin({ versionId: V1 }), pin({ versionId: V2 })];

    expect(findEquivocations(pins)).toHaveLength(0);
  });

  it("detects two conflicting claims about one version", () => {
    const first = pin({ versionId: V1, publishedAt: 100n });
    const second = pin({ versionId: V1, publishedAt: 200n });

    const proofs = findEquivocations([first, second]);

    expect(proofs).toHaveLength(1);
    expect(proofs[0]!.firstPinId).toBe(first.pinId);
    expect(proofs[0]!.guiltyPinId).toBe(second.pinId);
    expect(proofs[0]!.bondAtStake).toBe(second.requiredBond);
  });

  /// The earlier claim is what users approved against, so the offence is the
  /// contradiction introduced afterwards.
  it("blames the later claim regardless of input order", () => {
    const early = pin({ versionId: V1, publishedAt: 100n });
    const late = pin({ versionId: V1, publishedAt: 900n });

    for (const order of [[early, late], [late, early]]) {
      const proofs = findEquivocations(order);
      expect(proofs[0]!.guiltyPinId).toBe(late.pinId);
      expect(proofs[0]!.firstPinId).toBe(early.pinId);
    }
  });

  /** Publishing a genuinely new version is normal, never an offence. */
  it("does not flag different versions", () => {
    const pins = [pin({ versionId: V1 }), pin({ versionId: V2 })];

    expect(findEquivocations(pins)).toHaveLength(0);
  });

  it("does not flag different publishers sharing a version string", () => {
    const pins = [
      pin({ publisher: PUB_A, versionId: V1 }),
      pin({ publisher: PUB_B, versionId: V1 }),
    ];

    expect(findEquivocations(pins)).toHaveLength(0);
  });

  it("treats identical bytes under one version as no contradiction", () => {
    const hash = `0x${"cc".repeat(32)}` as Hex;
    const pins = [
      pin({ versionId: V1, skillHash: hash, publishedAt: 1n }),
      pin({ versionId: V1, skillHash: hash, publishedAt: 2n }),
    ];

    expect(findEquivocations(pins)).toHaveLength(0);
  });

  /** Three conflicting claims means two separately slashable offences. */
  it("returns one proof per later conflicting claim", () => {
    const first = pin({ versionId: V1, publishedAt: 1n });
    const second = pin({ versionId: V1, publishedAt: 2n });
    const third = pin({ versionId: V1, publishedAt: 3n });

    const proofs = findEquivocations([first, second, third]);

    expect(proofs).toHaveLength(2);
    expect(proofs.every((p) => p.firstPinId === first.pinId)).toBe(true);
    expect(proofs.map((p) => p.guiltyPinId).sort()).toEqual(
      [second.pinId, third.pinId].sort(),
    );
  });

  /** Its bond is gone; submitting would revert and waste gas. */
  it("skips an already-slashed pin", () => {
    const pins = [
      pin({ versionId: V1, publishedAt: 1n }),
      pin({ versionId: V1, publishedAt: 2n, slashed: true }),
    ];

    expect(findEquivocations(pins)).toHaveLength(0);
  });

  /** The registry refuses to slash a reclaimed bond, so do not try. */
  it("skips a pin whose bond was already reclaimed", () => {
    const pins = [
      pin({ versionId: V1, publishedAt: 1n }),
      pin({ versionId: V1, publishedAt: 2n, bondReclaimed: true }),
    ];

    expect(findEquivocations(pins)).toHaveLength(0);
  });

  /** In a race the reward goes to whoever lands first, so claim the biggest. */
  it("orders proofs by bond at stake, largest first", () => {
    const proofs = findEquivocations([
      pin({ versionId: V1, publishedAt: 1n, requiredBond: 100n }),
      pin({ versionId: V1, publishedAt: 2n, requiredBond: 100n }),
      pin({ versionId: V2, publishedAt: 3n, requiredBond: 9_000n }),
      pin({ versionId: V2, publishedAt: 4n, requiredBond: 9_000n }),
    ]);

    expect(proofs).toHaveLength(2);
    expect(proofs[0]!.bondAtStake).toBe(9_000n);
    expect(proofs[1]!.bondAtStake).toBe(100n);
  });

  it("handles an empty set", () => {
    expect(findEquivocations([])).toHaveLength(0);
  });
});

describe("isProfitable", () => {
  const proof = {
    publisher: PUB_A,
    versionId: V1,
    firstPinId: `0x${"01".repeat(32)}` as Hex,
    guiltyPinId: `0x${"02".repeat(32)}` as Hex,
    bondAtStake: 1_000_000n,
  };

  it("submits when the reward clears cost plus margin", () => {
    expect(
      isProfitable(proof, {
        challengerRewardBps: 5_000n,
        estimatedCostInBondAsset: 10_000n,
        minMargin: 1_000n,
      }),
    ).toBe(true);
  });

  /** Otherwise permissionless enforcement becomes a slow donation. */
  it("declines when gas would exceed the reward", () => {
    expect(
      isProfitable(proof, {
        challengerRewardBps: 5_000n,
        estimatedCostInBondAsset: 600_000n,
        minMargin: 0n,
      }),
    ).toBe(false);
  });

  it("declines when the margin is not met", () => {
    expect(
      isProfitable(proof, {
        challengerRewardBps: 5_000n,
        estimatedCostInBondAsset: 499_000n,
        minMargin: 2_000n,
      }),
    ).toBe(false);
  });

  it("declines when the reward share is zero", () => {
    expect(
      isProfitable(proof, {
        challengerRewardBps: 0n,
        estimatedCostInBondAsset: 0n,
        minMargin: 1n,
      }),
    ).toBe(false);
  });
});
