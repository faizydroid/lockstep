/**
 * Domain derivations.
 *
 * `pinStateOf` decides the colour and the words a reader sees for every pin in the app, so its
 * precedence is a product decision rather than an implementation detail. The bond breakdown is
 * tested against the registry's own formula, because a dashboard that explains a charge
 * incorrectly is worse than one that just states the total.
 */

import { describe, expect, it } from "vitest";
import { toFunctionSelector } from "viem";
import type { Address, Hex } from "viem";

import { bondBreakdown } from "@/lib/bond";
import { samplePins, samplePricing, sampleSnapshot } from "@/lib/fixtures";
import { isLive, pinStateOf } from "@/lib/model";
import type { Capability, Pin } from "@/lib/model";

const TARGET = "0x1111111111111111111111111111111111111111" as Address;

const cap = (signature: string, highRisk: boolean): Capability => ({
  target: TARGET,
  selector: toFunctionSelector(signature),
  label: signature,
  highRisk,
});

const pin = (overrides: Partial<Pin> = {}): Pin => ({
  pinId: `0x${"11".repeat(32)}` as Hex,
  publisher: TARGET,
  skillHash: `0x${"22".repeat(32)}` as Hex,
  versionId: `0x${"33".repeat(32)}` as Hex,
  maxValuePerCall: 0n,
  requiredBond: 125_000_000n,
  publishedAt: 1_772_000_000n,
  slashed: false,
  capabilities: [cap("swap(uint256)", false)],
  state: "bonded",
  ...overrides,
});

describe("pinStateOf", () => {
  it("reports a bonded pin when collateral is posted", () => {
    expect(pinStateOf({ slashed: false, requiredBond: 125_000_000n })).toBe("bonded");
  });

  /**
   * A live pin with no bond is not the same as a bonded one.
   *
   * Nothing is at stake, so there is nothing to slash if the publisher equivocates. The badge
   * says "pinned, no bond" for exactly this case and the UI must agree.
   */
  it("distinguishes a live pin with no bond from a bonded one", () => {
    expect(pinStateOf({ slashed: false, requiredBond: 0n })).toBe("pinned");
  });

  it("reports revoked once the publisher withdraws the release", () => {
    expect(pinStateOf({ slashed: false, requiredBond: 125_000_000n, revokedAt: 1_772_000_000n })).toBe(
      "revoked",
    );
  });

  /**
   * Severity order, which is the part worth pinning down.
   *
   * Equivocation outranks revocation. A slashed publisher will usually also have had both
   * conflicting pins revoked during the slash -- the registry emits Revoked as part of it -- so if
   * revocation won, every slashed pin would render as the milder state and the most serious fact
   * about it would disappear.
   */
  it("lets equivocation outrank revocation", () => {
    const state = pinStateOf({
      slashed: true,
      requiredBond: 125_000_000n,
      revokedAt: 1_772_000_000n,
    });
    expect(state).toBe("equivocated");
  });

  /** A publisher caught elsewhere taints their other pins, even unslashed ones. */
  it("marks a pin whose publisher has equivocated", () => {
    expect(
      pinStateOf({ slashed: false, requiredBond: 125_000_000n, publisherHasEquivocated: true }),
    ).toBe("equivocated");
  });

  it("treats a zero revokedAt as not revoked", () => {
    // The contract stores 0 rather than null for "never revoked", and that value reaches here.
    expect(pinStateOf({ slashed: false, requiredBond: 1n, revokedAt: 0n })).toBe("bonded");
  });
});

describe("isLive", () => {
  it("counts bonded and pinned as live, and nothing else", () => {
    expect(isLive(pin({ state: "bonded" }))).toBe(true);
    expect(isLive(pin({ state: "pinned" }))).toBe(true);
    expect(isLive(pin({ state: "revoked" }))).toBe(false);
    expect(isLive(pin({ state: "equivocated" }))).toBe(false);
  });
});

describe("bondBreakdown", () => {
  /** Must reproduce quoteBond exactly, or the explanation contradicts the charge. */
  it("sums to the registry's own formula", () => {
    const subject = pin({
      capabilities: [cap("swap(uint256)", false), cap("approve(address,uint256)", true)],
      maxValuePerCall: 500_000_000_000_000_000n,
    });

    const expected =
      samplePricing.baseBond +
      samplePricing.perCapabilityBond * 2n +
      samplePricing.highRiskBond * 1n +
      samplePricing.nativeValueBond;

    expect(bondBreakdown(subject, samplePricing).total).toBe(expected);
  });

  it("omits the native-value premium when the ceiling is zero", () => {
    const breakdown = bondBreakdown(pin({ maxValuePerCall: 0n }), samplePricing);
    expect(breakdown.parts.some((p) => p.label === "native value")).toBe(false);
  });

  it("charges the flat native premium once, however high the ceiling", () => {
    const low = bondBreakdown(pin({ maxValuePerCall: 1n }), samplePricing).total;
    const high = bondBreakdown(pin({ maxValuePerCall: 10n ** 21n }), samplePricing).total;

    // Deliberately not proportional: bonds are six-decimal and ceilings eighteen-decimal, so
    // scaling one by the other has no meaning without a price oracle.
    expect(low).toBe(high);
  });

  it("omits the high-risk line when nothing declared is high risk", () => {
    const breakdown = bondBreakdown(pin(), samplePricing);
    expect(breakdown.parts.some((p) => p.label.includes("high risk"))).toBe(false);
  });

  it("reports agreement with the bond recorded on chain", () => {
    const matching = pin({ requiredBond: samplePricing.baseBond + samplePricing.perCapabilityBond });
    expect(bondBreakdown(matching, samplePricing).matchesChain).toBe(true);

    // A pin's bond is frozen at publish time, so current prices can legitimately disagree. The
    // UI must be able to notice and say so rather than silently showing a wrong breakdown.
    expect(bondBreakdown(pin({ requiredBond: 1n }), samplePricing).matchesChain).toBe(false);
  });

  it("pluralises the capability line", () => {
    const single = bondBreakdown(pin(), samplePricing);
    expect(single.parts.some((p) => p.label === "1 capability")).toBe(true);

    const many = bondBreakdown(
      pin({ capabilities: [cap("swap(uint256)", false), cap("quote(uint256)", false)] }),
      samplePricing,
    );
    expect(many.parts.some((p) => p.label === "2 capabilities")).toBe(true);
  });
});

describe("sample data", () => {
  /**
   * The fixtures carry the demo, so their internal consistency is worth asserting. A sample
   * whose totals disagreed with its own rows would be caught by a viewer, on stage.
   */
  it("agrees with its own totals", () => {
    const snapshot = sampleSnapshot("test");

    expect(snapshot.totals.pins).toBe(snapshot.pins.length);
    expect(snapshot.totals.livePins).toBe(snapshot.pins.filter(isLive).length);
    expect(snapshot.totals.publishers).toBe(snapshot.publishers.length);
    expect(snapshot.totals.executions).toBe(snapshot.executions.length);
  });

  it("labels itself as sample data", () => {
    expect(sampleSnapshot("because").source).toEqual({ kind: "sample", reason: "because" });
  });

  it("carries the two hashes from the real run, and they differ", () => {
    const drift = sampleSnapshot("test").drifted[0];
    expect(drift).toBeDefined();
    expect(drift!.approvedHash).not.toBe(drift!.currentHash);
    // The whole demo rests on this being a widening, so it must never be auto-approvable.
    expect(drift!.diff.widened).toBe(true);
    expect(drift!.diff.added.length).toBeGreaterThan(0);
  });

  it("states each pin's state consistently with the derivation", () => {
    for (const sample of samplePins) {
      expect(sample.state).toBe(
        pinStateOf({
          slashed: sample.slashed,
          requiredBond: sample.requiredBond,
          ...(sample.revokedAt !== undefined ? { revokedAt: sample.revokedAt } : {}),
        }),
      );
    }
  });

  it("marks every high-risk capability with a genuinely high-risk selector", () => {
    // Guards against a fixture that paints a selector red for effect. approve and transferFrom
    // are on the registry's list; swap and deposit are not.
    const risky = new Set([
      toFunctionSelector("approve(address,uint256)"),
      toFunctionSelector("transferFrom(address,address,uint256)"),
    ]);

    for (const sample of samplePins) {
      for (const capability of sample.capabilities) {
        if (capability.highRisk) expect(risky.has(capability.selector)).toBe(true);
      }
    }
  });
});
