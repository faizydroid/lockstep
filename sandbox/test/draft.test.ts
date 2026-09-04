import { describe, expect, it } from "vitest";
import { toFunctionSelector, type Address, type Hex } from "viem";

import { draftFromObservations, renderManifest, selectorOf } from "../src/index.ts";

const ROUTER = "0x1111111111111111111111111111111111111111" as Address;
const TOKEN = "0x2222222222222222222222222222222222222222" as Address;

const SWAP = toFunctionSelector("swap(uint256)");
const APPROVE = toFunctionSelector("approve(address,uint256)");

const call = (to: Address, selector: Hex, value = 0n, reverted = false) => ({
  to,
  input: `${selector}${"00".repeat(32)}` as Hex,
  value,
  reverted,
});

describe("selectorOf", () => {
  it("takes the first four bytes", () => {
    expect(selectorOf(`${SWAP}deadbeef` as Hex)).toBe(SWAP);
  });

  /** A bare send has no selector, and must map to the one a pin declares for it. */
  it("maps empty calldata to the bare-send selector", () => {
    expect(selectorOf("0x")).toBe("0x00000000");
  });

  it("maps short calldata to the bare-send selector", () => {
    expect(selectorOf("0x1234")).toBe("0x00000000");
  });

  it("lowercases", () => {
    expect(selectorOf("0xAABBCCDD")).toBe("0xaabbccdd");
  });
});

describe("draftFromObservations", () => {
  it("produces one capability per distinct target and selector", () => {
    const draft = draftFromObservations([
      call(ROUTER, SWAP),
      call(ROUTER, SWAP),
      call(TOKEN, APPROVE),
    ]);

    expect(draft.capabilities).toHaveLength(2);
    const swap = draft.capabilities.find((c) => c.selector === SWAP);
    expect(swap?.observations).toBe(2);
  });

  it("distinguishes the same selector on different targets", () => {
    const draft = draftFromObservations([call(ROUTER, SWAP), call(TOKEN, SWAP)]);

    expect(draft.capabilities).toHaveLength(2);
  });

  it("records the largest observed native value", () => {
    const draft = draftFromObservations([
      call(ROUTER, SWAP, 1n),
      call(ROUTER, SWAP, 500n),
      call(ROUTER, SWAP, 20n),
    ]);

    expect(draft.maxValuePerCall).toBe(500n);
  });

  /**
   * A skill that tried to call `approve` and failed still intends to. Omitting it
   * produces a manifest that breaks the first time the call succeeds.
   */
  it("includes reverted calls and flags them", () => {
    const draft = draftFromObservations([call(TOKEN, APPROVE, 0n, true)]);

    expect(draft.capabilities).toHaveLength(1);
    expect(draft.capabilities[0]!.everReverted).toBe(true);
    expect(draft.warnings.some((w) => w.includes("reverted"))).toBe(true);
  });

  it("warns when a capability was seen only once", () => {
    const draft = draftFromObservations([call(ROUTER, SWAP)]);

    expect(draft.warnings.some((w) => w.includes("observed once"))).toBe(true);
  });

  it("does not warn about a repeatedly observed capability", () => {
    const draft = draftFromObservations([call(ROUTER, SWAP), call(ROUTER, SWAP)]);

    expect(draft.warnings.some((w) => w.includes("observed once"))).toBe(false);
  });

  /** A native-value capability carries a flat bond premium, so it must be visible. */
  it("warns about native value", () => {
    const draft = draftFromObservations([call(ROUTER, SWAP, 1n)]);

    expect(draft.warnings.some((w) => w.includes("native value"))).toBe(true);
  });

  /** A skill needing no on-chain capability should not be pinned at all. */
  it("warns when nothing was observed", () => {
    const draft = draftFromObservations([]);

    expect(draft.capabilities).toHaveLength(0);
    expect(draft.warnings.some((w) => w.includes("no on-chain calls"))).toBe(true);
  });

  it("skips malformed addresses rather than emitting a broken manifest", () => {
    const draft = draftFromObservations([
      { to: "0x1234" as Address, input: SWAP, value: 0n },
      call(ROUTER, SWAP),
    ]);

    expect(draft.capabilities).toHaveLength(1);
    expect(draft.warnings.some((w) => w.includes("malformed address"))).toBe(true);
  });

  it("orders output deterministically", () => {
    const a = draftFromObservations([call(TOKEN, APPROVE), call(ROUTER, SWAP)]);
    const b = draftFromObservations([call(ROUTER, SWAP), call(TOKEN, APPROVE)]);

    expect(a.capabilities.map((c) => c.target)).toEqual(b.capabilities.map((c) => c.target));
  });
});

describe("renderManifest", () => {
  it("emits a document the CLI parser accepts", () => {
    const draft = draftFromObservations([call(ROUTER, SWAP)]);
    const parsed = JSON.parse(renderManifest("kuru-quote", "1.0.0", draft));

    expect(parsed.name).toBe("kuru-quote");
    expect(parsed.version).toBe("1.0.0");
    expect(parsed.capabilities.onchain.calls).toHaveLength(1);
    expect(parsed.capabilities.onchain.calls[0].target).toBe(ROUTER);
  });

  /** wei as a string, never a JSON number, or large values lose precision. */
  it("serialises the value ceiling as a decimal string", () => {
    const draft = draftFromObservations([call(ROUTER, SWAP, 1234567890123456789n)]);
    const parsed = JSON.parse(renderManifest("s", "1", draft));

    expect(parsed.capabilities.onchain.maxValuePerCall).toBe("1234567890123456789");
  });

  /** The output is a starting point, and must say so where a publisher will read it. */
  it("marks itself as a draft", () => {
    const rendered = renderManifest("s", "1", draftFromObservations([call(ROUTER, SWAP)]));

    expect(rendered).toContain("_draft");
    expect(rendered).toContain("signatures");
  });
});
