/**
 * The three allowed writes, checked without a wallet.
 *
 * What matters here is not that viem can encode a call -- it can -- but that each request goes to the
 * right address, and that the two guard writes go to the *account* rather than to some deployed contract.
 * That is the detail EIP-7702 makes counter-intuitive and the one most likely to be "corrected" by
 * someone who assumes a guard has an address of its own.
 *
 * The forbidden-call assertions are the belt to the ABI's braces. A missing fragment already makes those
 * calls unencodable, so these tests are checking the second line of defence rather than the first.
 */

import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";

import {
  ForbiddenWriteError,
  buildWrite,
  delegationTarget,
  isDelegatedToGuard,
} from "@/lib/writes";
import type { WriteName } from "@/lib/writes";

const ACCOUNT = "0x209C903f68f169C8e654e0C3C91cAdc4C4A4aFF2" as Address;
const REGISTRY = "0xF0800974aE84F55508E3e31F72A52E09b19829B0" as Address;
const GUARD = "0xee23156D1B7D64aF1b3671290DdcEf6edF734a81" as Address;
const PIN_A = `0x${"11".repeat(32)}` as Hex;
const PIN_B = `0x${"22".repeat(32)}` as Hex;

const ctx = { account: ACCOUNT, registry: REGISTRY };

describe("buildWrite targets", () => {
  it("sends unapprovePin to the account, not to a contract", () => {
    /*
     * The whole point of 7702: the guard's code runs at the account's address, so the account IS the
     * contract. Sending this to the guard address would revert, because that deployment holds none of
     * the account's approvals -- they live in the account's own ERC-7201 slot.
     */
    const req = buildWrite("unapprovePin", [PIN_A], ctx);
    expect(req.to).toBe(ACCOUNT);
    expect(req.to).not.toBe(GUARD);
    expect(req.functionName).toBe("unapprovePin");
    expect(req.args).toEqual([PIN_A]);
  });

  it("sends revokeExecutor to the account too", () => {
    const executor = "0x1111111111111111111111111111111111111111" as Address;
    const req = buildWrite("revokeExecutor", [executor], ctx);
    expect(req.to).toBe(ACCOUNT);
    expect(req.args).toEqual([executor]);
  });

  it("sends slashEquivocation to the registry, because it is not account state", () => {
    const req = buildWrite("slashEquivocation", [PIN_A, PIN_B], ctx);
    expect(req.to).toBe(REGISTRY);
    expect(req.args).toEqual([PIN_A, PIN_B]);
  });
});

describe("confirmation copy", () => {
  const NAMES: readonly WriteName[] = ["unapprovePin", "revokeExecutor", "slashEquivocation"];

  it("states an effect and a limit for every action", () => {
    /*
     * The limit is the load-bearing half.
     *
     * People assume withdrawing an approval claws money back, and that challenging a publisher is an
     * accusation the chain takes on trust. Both are wrong, and a confirmation that only describes the
     * upside is how that misunderstanding survives.
     */
    for (const name of NAMES) {
      const req = buildWrite(name, [PIN_A, PIN_B], ctx);
      expect(req.title.length, `${name} title`).toBeGreaterThan(8);
      expect(req.effect.length, `${name} effect`).toBeGreaterThan(40);
      expect(req.limit.length, `${name} limit`).toBeGreaterThan(40);
      expect(req.cta.length, `${name} cta`).toBeGreaterThan(4);
    }
  });

  it("tells the reader that re-approving needs the CLI", () => {
    const req = buildWrite("unapprovePin", [PIN_A], ctx);
    expect(req.limit).toMatch(/CLI/);
  });

  it("does not present a challenge as an accusation the chain trusts", () => {
    const req = buildWrite("slashEquivocation", [PIN_A, PIN_B], ctx);
    expect(req.limit.toLowerCase()).toMatch(/verif|itself|revert/);
  });
});

describe("forbidden writes are refused at runtime as well as unencodable", () => {
  for (const fn of ["approvePin", "publish", "execute"]) {
    it(`refuses ${fn}`, () => {
      // Cast because the type already excludes these; the guard is for a future refactor that widens it.
      expect(() => buildWrite(fn as WriteName, [PIN_A], ctx)).toThrow(ForbiddenWriteError);
    });
  }

  it("explains why rather than just failing", () => {
    try {
      buildWrite("approvePin" as WriteName, [PIN_A], ctx);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).message).toMatch(/browser/);
      expect((err as Error).message.toLowerCase()).toMatch(/byte|hash/);
    }
  });
});

describe("7702 delegation detection", () => {
  const indicator = `0xef0100${GUARD.slice(2).toLowerCase()}`;

  it("recognises a delegation to this guard", () => {
    expect(isDelegatedToGuard(indicator, GUARD)).toBe(true);
  });

  it("is case-insensitive, since eth_getCode casing is not guaranteed", () => {
    expect(isDelegatedToGuard(indicator.toUpperCase().replace("0XEF0100", "0xef0100"), GUARD)).toBe(
      true,
    );
  });

  it("rejects a delegation to a different implementation", () => {
    const other = "0x1111111111111111111111111111111111111111" as Address;
    expect(isDelegatedToGuard(`0xef0100${other.slice(2)}`, GUARD)).toBe(false);
  });

  it("rejects a plain EOA and a real contract", () => {
    // No code at all: an ordinary EOA, never delegated.
    expect(isDelegatedToGuard("0x", GUARD)).toBe(false);
    expect(isDelegatedToGuard(undefined, GUARD)).toBe(false);
    // Actual bytecode, which is a contract rather than a delegation indicator.
    expect(isDelegatedToGuard("0x60806040523480156100", GUARD)).toBe(false);
  });

  it("extracts the implementation address from an indicator", () => {
    expect(delegationTarget(indicator)?.toLowerCase()).toBe(GUARD.toLowerCase());
    expect(delegationTarget("0x")).toBeUndefined();
    expect(delegationTarget("0x60806040")).toBeUndefined();
  });
});
