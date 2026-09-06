import { describe, expect, it } from "vitest";
import { toFunctionSelector, type Address, type Hex } from "viem";

import { diffCapabilities, type PinCapability, type PinSummary } from "../src/pins.ts";
import { isHighRiskSelector } from "../src/risk.ts";

const ROUTER = "0x1111111111111111111111111111111111111111" as Address;
const TOKEN = "0x2222222222222222222222222222222222222222" as Address;
const PUBLISHER = "0x3333333333333333333333333333333333333333" as Address;

const SWAP = toFunctionSelector("swap(uint256)");
const QUOTE = toFunctionSelector("quote(uint256)");
const APPROVE = toFunctionSelector("approve(address,uint256)");

const cap = (target: Address, selector: Hex): PinCapability => ({
  target,
  selector,
  highRisk: isHighRiskSelector(selector),
});

const pin = (
  skillHash: string,
  capabilities: readonly PinCapability[],
  maxValuePerBatch = 0n,
): PinSummary => ({
  pinId: `0x${skillHash.repeat(32).slice(0, 64)}` as Hex,
  publisher: PUBLISHER,
  skillHash: `0x${skillHash.repeat(32).slice(0, 64)}` as Hex,
  // Fields the summary gained once the getPin tuple was completed. The diff ignores all of
  // them -- it compares capability keys and the value ceiling and nothing else -- but they are
  // fixed here rather than defaulted so a future field cannot quietly acquire a meaning in the
  // diff without a test changing.
  versionId: `0x${"99".repeat(32)}` as Hex,
  requiredBond: 1_500_000_000n,
  publishedAt: 1_760_000_000n,
  slashed: false,
  maxValuePerBatch,
  revoked: false,
  capabilities,
});

describe("diffCapabilities", () => {
  /**
   * The case that must never prompt. A rebuild changes bytes but declares the
   * same powers, and prompting for it every release is how permission systems
   * train people to click through without reading.
   */
  it("does not report widening when only the code changed", () => {
    const before = pin("aa", [cap(ROUTER, SWAP)]);
    const after = pin("bb", [cap(ROUTER, SWAP)]);

    const diff = diffCapabilities(before, after);

    expect(diff.widened).toBe(false);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(1);
  });

  /** The case that must always prompt. */
  it("reports widening when a capability is added", () => {
    const before = pin("aa", [cap(ROUTER, SWAP)]);
    const after = pin("bb", [cap(ROUTER, SWAP), cap(TOKEN, APPROVE)]);

    const diff = diffCapabilities(before, after);

    expect(diff.widened).toBe(true);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0]!.selector).toBe(APPROVE);
    expect(diff.added[0]!.highRisk).toBe(true);
  });

  /** Narrowing is safe: nothing new becomes reachable. */
  it("does not report widening when a capability is removed", () => {
    const before = pin("aa", [cap(ROUTER, SWAP), cap(ROUTER, QUOTE)]);
    const after = pin("bb", [cap(ROUTER, SWAP)]);

    const diff = diffCapabilities(before, after);

    expect(diff.widened).toBe(false);
    expect(diff.removed).toHaveLength(1);
  });

  it("reports widening when the native value ceiling rises", () => {
    const before = pin("aa", [cap(ROUTER, SWAP)], 1n);
    const after = pin("bb", [cap(ROUTER, SWAP)], 2n);

    expect(diffCapabilities(before, after).widened).toBe(true);
  });

  it("does not report widening when the value ceiling falls", () => {
    const before = pin("aa", [cap(ROUTER, SWAP)], 2n);
    const after = pin("bb", [cap(ROUTER, SWAP)], 1n);

    expect(diffCapabilities(before, after).widened).toBe(false);
  });

  /** Same selector, different contract, is a new capability. */
  it("treats the same selector on a new target as an addition", () => {
    const before = pin("aa", [cap(ROUTER, SWAP)]);
    const after = pin("bb", [cap(TOKEN, SWAP)]);

    const diff = diffCapabilities(before, after);

    expect(diff.widened).toBe(true);
    expect(diff.added).toHaveLength(1);
    expect(diff.removed).toHaveLength(1);
  });

  it("reports both additions and removals in one change", () => {
    const before = pin("aa", [cap(ROUTER, SWAP), cap(ROUTER, QUOTE)]);
    const after = pin("bb", [cap(ROUTER, SWAP), cap(TOKEN, APPROVE)]);

    const diff = diffCapabilities(before, after);

    expect(diff.added.map((c) => c.selector)).toEqual([APPROVE]);
    expect(diff.removed.map((c) => c.selector)).toEqual([QUOTE]);
    expect(diff.unchanged.map((c) => c.selector)).toEqual([SWAP]);
    expect(diff.widened).toBe(true);
  });

  it("matches capabilities case-insensitively on the target", () => {
    const before = pin("aa", [cap(ROUTER.toLowerCase() as Address, SWAP)]);
    const after = pin("bb", [cap(ROUTER.toUpperCase().replace("0X", "0x") as Address, SWAP)]);

    expect(diffCapabilities(before, after).widened).toBe(false);
  });

  it("reports every capability as added when the previous pin declared none", () => {
    const before = pin("aa", []);
    const after = pin("bb", [cap(ROUTER, SWAP), cap(TOKEN, APPROVE)]);

    const diff = diffCapabilities(before, after);

    expect(diff.added).toHaveLength(2);
    expect(diff.widened).toBe(true);
  });
});
