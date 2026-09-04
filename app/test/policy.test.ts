/**
 * The browser write boundary, enforced against the contracts rather than trusted.
 *
 * Three claims, each of which would otherwise decay quietly:
 *
 *   1. Every state-changing function in both contracts has a verdict. An incomplete allowlist fails
 *      open -- a function nobody ruled on is a function the UI may end up calling -- so a new write in
 *      Solidity breaks this test until someone decides about it.
 *
 *   2. The classification names real functions. A typo in a rule is worse than a missing rule: it looks
 *      like coverage and enforces nothing.
 *
 *   3. `abi.ts` carries no fragment for a cli-only function. This is the actual mechanism. viem can only
 *      encode a call it has a fragment for, so withholding the fragment makes the forbidden calls
 *      unrepresentable in the client rather than merely discouraged.
 *
 * Reads the compiled artifacts, in the same spirit as e2e/test/abi.test.ts, which caught a real
 * nine-versus-eleven-field drift that had been silently breaking `lockstep status`.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CLI_ONLY, BROWSER_WRITES, WRITE_RULES, needsHardConfirm, ruleFor } from "@/lib/policy";

interface AbiEntry {
  readonly type: string;
  readonly name?: string;
  readonly stateMutability?: string;
}

function artifact(name: string): readonly AbiEntry[] {
  // Relative to the app package, which is where vitest runs.
  const path = new URL(`../../contracts/out/${name}.sol/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(path, "utf8")).abi as AbiEntry[];
}

function writesOf(name: string): readonly string[] {
  return artifact(name)
    .filter(
      (e) =>
        e.type === "function" &&
        e.stateMutability !== "view" &&
        e.stateMutability !== "pure" &&
        e.name !== undefined,
    )
    .map((e) => e.name as string)
    .sort();
}

const CONTRACTS = ["PinRegistry", "LockstepGuard"] as const;

describe("write policy is exhaustive", () => {
  for (const contract of CONTRACTS) {
    it(`covers every state-changing function in ${contract}`, () => {
      const onChain = writesOf(contract);
      const classified = WRITE_RULES.filter((r) => r.contract === contract)
        .map((r) => r.fn)
        .sort();

      // Both directions. Missing means fail-open; extra means a typo masquerading as coverage.
      expect(classified).toEqual(onChain);
    });
  }

  it("gives every rule a non-empty reason", () => {
    for (const rule of WRITE_RULES) {
      expect(rule.because.length, `${rule.fn} has no reason`).toBeGreaterThan(20);
    }
  });

  it("keeps the two lists disjoint and complete", () => {
    expect([...CLI_ONLY, ...BROWSER_WRITES].sort()).toEqual(WRITE_RULES.map((r) => r.fn).sort());
    for (const fn of CLI_ONLY) expect(BROWSER_WRITES).not.toContain(fn);
  });
});

describe("the three byte-attesting functions stay out of the browser", () => {
  /*
   * Named explicitly rather than derived.
   *
   * Deriving the expected set from the same data the rules come from would make this test tautological.
   * These three are the actual product decision, so they are written out, and if someone reclassifies
   * one the test fails and they have to come here and argue for it.
   */
  it("forbids approvePin, publish and execute", () => {
    expect([...CLI_ONLY].sort()).toEqual(["approvePin", "execute", "publish"]);
  });

  it("explains each one in terms of bytes", () => {
    for (const fn of CLI_ONLY) {
      const rule = ruleFor(fn);
      expect(rule).toBeDefined();
      expect(rule?.because.toLowerCase()).toMatch(/byte|hash/);
    }
  });
});

describe("the client ABI cannot encode a forbidden call", () => {
  /*
   * The enforcement, not a restatement of it.
   *
   * viem builds calldata from a fragment. With no fragment there is no way to encode the call, so this
   * is a structural guarantee rather than a policy someone has to remember. Checked against the source
   * because that is where a fragment would be added.
   */
  const abiSource = readFileSync(new URL("../src/lib/abi.ts", import.meta.url), "utf8");

  for (const fn of CLI_ONLY) {
    it(`has no fragment for ${fn}`, () => {
      expect(abiSource).not.toMatch(new RegExp(`name:\\s*["']${fn}["']`));
    });
  }

  it("does have fragments for the writes the UI is allowed to send", () => {
    /*
     * The complement, so this suite fails if someone "fixes" it by emptying the ABI entirely.
     *
     * Only asserted for the writes actually wired into the UI. A verdict of `browser` is permission, not
     * an obligation to build the button, so this checks the ones that exist rather than all five.
     */
    const wired = ["unapprovePin", "revokeExecutor", "slashEquivocation"];
    for (const fn of wired) {
      expect(BROWSER_WRITES).toContain(fn);
      expect(abiSource, `${fn} is wired in the UI but has no ABI fragment`).toMatch(
        new RegExp(`name:\\s*["']${fn}["']`),
      );
    }
  });
});

describe("confirmation strength follows widening", () => {
  it("demands a hard confirm only for browser writes that grant power", () => {
    expect(needsHardConfirm("authorizeExecutor")).toBe(true);
    // Narrowing actions are emergency stops. Putting friction on them is its own hazard.
    expect(needsHardConfirm("unapprovePin")).toBe(false);
    expect(needsHardConfirm("revokeExecutor")).toBe(false);
    expect(needsHardConfirm("revoke")).toBe(false);
    // Forbidden actions never reach a confirmation at all.
    expect(needsHardConfirm("approvePin")).toBe(false);
    expect(needsHardConfirm("publish")).toBe(false);
  });
});
