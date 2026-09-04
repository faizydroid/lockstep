import { describe, expect, it } from "vitest";
import { toFunctionSelector } from "viem";

import { parseManifest } from "../src/manifest.ts";
import { HIGH_RISK_LABELS, isHighRiskSelector } from "../src/risk.ts";

const ROUTER = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";

const valid = {
  schema: "lockstep/1",
  name: "kuru-quote",
  version: "1.0.0",
  capabilities: {
    onchain: {
      calls: [{ target: ROUTER, selector: "swap(uint256)" }],
      maxValuePerCall: "0",
    },
  },
};

describe("parseManifest", () => {
  it("derives the selector from a signature", () => {
    const m = parseManifest(valid);

    expect(m.capabilities).toHaveLength(1);
    expect(m.capabilities[0]!.selector).toBe(toFunctionSelector("swap(uint256)"));
    expect(m.capabilities[0]!.label).toBe("swap(uint256)");
  });

  it("accepts a raw 4-byte selector", () => {
    const m = parseManifest({
      ...valid,
      capabilities: { onchain: { calls: [{ target: ROUTER, selector: "0xDEADBEEF" }] } },
    });

    expect(m.capabilities[0]!.selector).toBe("0xdeadbeef");
  });

  it("checksums the target address", () => {
    const m = parseManifest({
      ...valid,
      capabilities: { onchain: { calls: [{ target: ROUTER.toUpperCase().replace("0X", "0x"), selector: "swap(uint256)" }] } },
    });

    expect(m.capabilities[0]!.target).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("defaults maxValuePerCall to zero", () => {
    const m = parseManifest({
      ...valid,
      capabilities: { onchain: { calls: [{ target: ROUTER, selector: "swap(uint256)" }] } },
    });

    expect(m.maxValuePerCall).toBe(0n);
  });

  it("parses a wei string without precision loss", () => {
    const m = parseManifest({
      ...valid,
      capabilities: {
        onchain: {
          calls: [{ target: ROUTER, selector: "swap(uint256)" }],
          maxValuePerCall: "1234567890123456789",
        },
      },
    });

    expect(m.maxValuePerCall).toBe(1234567890123456789n);
  });

  /** A float would silently truncate. Refusing is better than guessing. */
  it("rejects a non-integer value", () => {
    expect(() =>
      parseManifest({
        ...valid,
        capabilities: {
          onchain: { calls: [{ target: ROUTER, selector: "swap(uint256)" }], maxValuePerCall: 1.5 },
        },
      }),
    ).toThrow(/maxValuePerCall/);
  });

  it.each([
    [{}, /name is required/],
    [{ name: "a" }, /version is required/],
    [{ name: "a", version: "1" }, /capabilities.onchain is required/],
    [{ name: "a", version: "1", capabilities: { onchain: {} } }, /must be a non-empty array/],
    [
      { name: "a", version: "1", capabilities: { onchain: { calls: [] } } },
      /must be a non-empty array/,
    ],
  ])("rejects an incomplete manifest (%#)", (input, pattern) => {
    expect(() => parseManifest(input)).toThrow(pattern);
  });

  it("rejects a malformed target", () => {
    expect(() =>
      parseManifest({
        ...valid,
        capabilities: { onchain: { calls: [{ target: "0x1234", selector: "swap(uint256)" }] } },
      }),
    ).toThrow(/must be a 20-byte address/);
  });

  it("rejects a selector that is neither a signature nor 4 bytes", () => {
    expect(() =>
      parseManifest({
        ...valid,
        capabilities: { onchain: { calls: [{ target: ROUTER, selector: "swap" }] } },
      }),
    ).toThrow(/function signature/);
  });

  /** The registry rejects duplicates on chain; catching it here names the entry. */
  it("rejects duplicate capabilities", () => {
    expect(() =>
      parseManifest({
        ...valid,
        capabilities: {
          onchain: {
            calls: [
              { target: ROUTER, selector: "swap(uint256)" },
              { target: ROUTER, selector: "swap(uint256)" },
            ],
          },
        },
      }),
    ).toThrow(/duplicate capability/);
  });

  it("treats differing case in the target as the same capability", () => {
    expect(() =>
      parseManifest({
        ...valid,
        capabilities: {
          onchain: {
            calls: [
              { target: ROUTER, selector: "swap(uint256)" },
              { target: ROUTER.toUpperCase().replace("0X", "0x"), selector: "swap(uint256)" },
            ],
          },
        },
      }),
    ).toThrow(/duplicate capability/);
  });
});

describe("high-risk selectors", () => {
  it.each([
    "approve(address,uint256)",
    "transfer(address,uint256)",
    "transferFrom(address,address,uint256)",
    "setApprovalForAll(address,bool)",
    "increaseAllowance(address,uint256)",
    "delegate(address)",
    "upgradeTo(address)",
  ])("flags %s", (signature) => {
    expect(isHighRiskSelector(toFunctionSelector(signature))).toBe(true);
  });

  it.each(["swap(uint256)", "balanceOf(address)", "deposit()"])("does not flag %s", (signature) => {
    expect(isHighRiskSelector(toFunctionSelector(signature))).toBe(false);
  });

  /** A bare native send to an arbitrary address is the most direct drain there is. */
  it("flags empty calldata", () => {
    expect(isHighRiskSelector("0x00000000")).toBe(true);
  });

  it("carries a human-readable reason for every flagged selector", () => {
    for (const [selector, label] of Object.entries(HIGH_RISK_LABELS)) {
      expect(selector).toMatch(/^0x[0-9a-f]{8}$/);
      expect(label.length).toBeGreaterThan(10);
    }
  });

  it("recognises a selector regardless of case", () => {
    const approve = toFunctionSelector("approve(address,uint256)");

    expect(isHighRiskSelector(approve.toUpperCase().replace("0X", "0x") as `0x${string}`)).toBe(true);
  });

  it("mirrors the twelve entries priced by the registry", () => {
    // Must match HighRiskSelectors.all() in Solidity. A drift here means the CLI
    // under-warns about a capability the chain charges a premium for.
    expect(Object.keys(HIGH_RISK_LABELS)).toHaveLength(12);
  });
});
