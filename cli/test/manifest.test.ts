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
      maxValuePerBatch: "0",
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

  it("defaults maxValuePerBatch to zero", () => {
    const m = parseManifest({
      ...valid,
      capabilities: { onchain: { calls: [{ target: ROUTER, selector: "swap(uint256)" }] } },
    });

    expect(m.maxValuePerBatch).toBe(0n);
  });

  it("parses a wei string without precision loss", () => {
    const m = parseManifest({
      ...valid,
      capabilities: {
        onchain: {
          calls: [{ target: ROUTER, selector: "swap(uint256)" }],
          maxValuePerBatch: "1234567890123456789",
        },
      },
    });

    expect(m.maxValuePerBatch).toBe(1234567890123456789n);
  });

  /** A float would silently truncate. Refusing is better than guessing. */
  it("rejects a non-integer value", () => {
    expect(() =>
      parseManifest({
        ...valid,
        capabilities: {
          onchain: { calls: [{ target: ROUTER, selector: "swap(uint256)" }], maxValuePerBatch: 1.5 },
        },
      }),
    ).toThrow(/maxValuePerBatch/);
  });

  /**
   * The old key must fail loudly rather than being ignored.
   *
   * An unknown key would fall through to the default of zero, so a manifest still saying
   * `maxValuePerCall` would publish a pin that can move no native value at all -- fail-closed, but
   * silently, leaving the publisher debugging a skill whose manifest looks like it should work.
   */
  it("refuses the pre-rename maxValuePerCall key by name", () => {
    expect(() =>
      parseManifest({
        ...valid,
        capabilities: {
          onchain: {
            calls: [{ target: ROUTER, selector: "swap(uint256)" }],
            maxValuePerCall: "500000000000000000",
          },
        },
      }),
    ).toThrow(/maxValuePerCall was renamed to maxValuePerBatch/);
  });

  /*
   * Label rules, mirroring `PinRegistry._requireLabel`.
   *
   * The registry derives the on-chain version id from the name and version, which stops a publisher
   * choosing an arbitrary id but not an arbitrary *label*. `"kuru-quote "` and a Cyrillic `о` both
   * render as the skill users already trust while hashing to an unrelated version, so the chain
   * refuses them -- and the CLI refuses them first, because learning this from a reverted
   * transaction costs gas to discover what a string comparison knows for free.
   */
  it.each([
    ["kuru-quote ", "trailing space"],
    [" kuru-quote", "leading space"],
    ["kuru quote", "inner space"],
    ["kuru\tquote", "tab"],
    ["kuru-qu\u043Ete", "Cyrillic lookalike"],
    ["café", "non-ASCII"],
  ])("rejects %o as a name (%s)", (name) => {
    expect(() => parseManifest({ ...valid, name })).toThrow(/printable ASCII/);
  });

  it("rejects a confusable version string too", () => {
    expect(() => parseManifest({ ...valid, version: "1.0.0 " })).toThrow(/printable ASCII/);
  });

  it("rejects a label longer than the registry accepts", () => {
    expect(() => parseManifest({ ...valid, name: "a".repeat(65) })).toThrow(/at most 64/);
  });

  it("accepts a label exactly at the limit", () => {
    expect(parseManifest({ ...valid, name: "a".repeat(64) }).name).toBe("a".repeat(64));
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

  /*
   * The label is what a reviewer reads, so it has to be exactly what was hashed.
   *
   * viem hashes the text up to the first closing parenthesis and ignores the rest, so each of these
   * used to be accepted with the selector of the part that came first, carrying the rest into the
   * Action's table and the CLI's prompt. `<!--` in a job summary opens an HTML comment, which hid
   * the two real high-risk rows of a capability table from the person reviewing the pull request.
   */
  const withSelector = (selector: string) => ({
    ...valid,
    capabilities: { onchain: { calls: [{ target: ROUTER, selector }] } },
  });

  it.each([
    ["swap(uint256)<!--", "an HTML comment opener after the signature"],
    ["swap(uint256)<!-- hidden -->(x)", "a comment, closed by a parenthesis"],
    ["swap(uint256)(uint256)", "a second parenthesised group"],
    ["swap(uint256) ", "trailing space"],
    ["swap(uint256)\n| `x` | `y` |", "a newline and a table row"],
    ["swap(uint256)`", "a backtick"],
    ["approve(address spender,uint256 value)", "parameter names"],
    ["function approve(address,uint256)", "a function keyword"],
    ["approve (address,uint256)", "a space before the parenthesis"],
    ["swap((uint256)", "unbalanced parentheses"],
    ["(uint256)", "no function name"],
    ["1swap(uint256)", "a name starting with a digit"],
  ])("rejects %o as a selector (%s)", (selector) => {
    expect(() => parseManifest(withSelector(selector))).toThrow(/function signature/);
  });

  it("accepts a tuple parameter and an array parameter", () => {
    const m = parseManifest({
      ...valid,
      capabilities: {
        onchain: {
          calls: [
            { target: ROUTER, selector: "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))" },
            { target: TOKEN, selector: "multicall(bytes[])" },
            { target: TOKEN, selector: "fill(uint256[2])" },
            { target: TOKEN, selector: "ping()" },
          ],
        },
      },
    });
    expect(m.capabilities.map((c) => c.label)).toEqual([
      "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
      "multicall(bytes[])",
      "fill(uint256[2])",
      "ping()",
    ]);
  });

  it("keeps the label equal to the hashed text for every accepted signature", () => {
    for (const selector of ["swap(uint256)", "multicall(bytes[])", "ping()"]) {
      const m = parseManifest(withSelector(selector));
      expect(m.capabilities[0]!.label).toBe(selector);
      expect(m.capabilities[0]!.selector).toBe(toFunctionSelector(m.capabilities[0]!.label));
    }
  });

  /**
   * The error is printed by the CLI to a terminal and by the Action into a workflow command, both from
   * a file a pull request controls. It must not carry control characters, and it must not carry
   * arbitrary amounts of attacker text.
   */
  it("does not echo raw control characters or an unbounded string in the error", () => {
    const hostile = `swap(uint256)\n::warning title=ok::${"x".repeat(500)}\u001b[2J`;
    let message = "";
    try {
      parseManifest(withSelector(hostile));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/function signature/);
    expect(message).not.toContain("\n");
    expect(message).not.toContain("\u001b");
    expect(message.length).toBeLessThan(400);
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
