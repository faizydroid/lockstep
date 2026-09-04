import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";

import {
  GUARD_STORAGE_SLOT,
  delegationCopy,
  describeGuard,
  isDelegatedTo,
  parseDelegation,
} from "../src/lib/profile";

/**
 * The question the profile exists to answer is "is anything actually enforcing my approvals", and
 * getting it wrong in the reassuring direction is the failure that matters.
 *
 * `contracts/test/GatorComparison.t.sol` established why: EIP-7702 delegation changes an account's
 * code but not its storage, so moving a delegation leaves approvals sitting in the ERC-7201 slot with
 * nothing reading them, and storage looks untouched. An interface that reported that account as
 * guarded would be confidently wrong at exactly the moment it mattered.
 */

const GUARD = "0xC41eCe384Ee559A30Ed350Ce26ba563B618A3510" as Address;
const LIVE_CODE = "0xef0100c41ece384ee559a30ed350ce26ba563b618a3510";

describe("parseDelegation", () => {
  it("reads the live account's real code", () => {
    // Read off chain from 0x209C903f68f169C8e654e0C3C91cAdc4C4A4aFF2.
    const parsed = parseDelegation(LIVE_CODE);
    expect(parsed.kind).toBe("delegated");
    expect(parsed.kind === "delegated" && parsed.implementation).toBe(
      "0xc41ece384ee559a30ed350ce26ba563b618a3510",
    );
  });

  it("treats no code, empty code and absent code alike", () => {
    for (const input of [undefined, null, "0x", ""]) {
      expect(parseDelegation(input).kind, JSON.stringify(input)).toBe("none");
    }
  });

  it("distinguishes a contract from an undelegated EOA", () => {
    // Not pedantry: "delegate this account" is impossible advice for a contract, so folding the two
    // together would put an unfollowable instruction on screen.
    const parsed = parseDelegation(`0x${"60".repeat(200)}`);
    expect(parsed.kind).toBe("contract");
    expect(parsed.kind === "contract" && parsed.size).toBe(200);
  });

  it("refuses code that merely starts with the indicator prefix", () => {
    // The sharp edge. A 23-byte indicator is exact; anything longer beginning ef0100 is a contract
    // whose first bytes collide, and reading an implementation address out of it would invent one.
    const parsed = parseDelegation(`${LIVE_CODE}00`);
    expect(parsed.kind).toBe("contract");
  });

  it("refuses a prefix-only or truncated indicator", () => {
    expect(parseDelegation("0xef0100").kind).toBe("contract");
    expect(parseDelegation("0xef0100c41ece").kind).toBe("contract");
  });

  it("accepts either casing and normalises", () => {
    expect(parseDelegation(LIVE_CODE.toUpperCase().replace("0X", "0x")).kind).toBe("delegated");
  });

  it("tolerates a missing 0x prefix", () => {
    expect(parseDelegation(LIVE_CODE.slice(2)).kind).toBe("delegated");
  });

  it("does not silently truncate an odd-length string", () => {
    // Half a byte is not bytes. Truncating would produce a plausible wrong answer.
    expect(parseDelegation("0xef010").kind).toBe("contract");
  });
});

describe("isDelegatedTo", () => {
  it("confirms the live account points at the live guard", () => {
    expect(isDelegatedTo(parseDelegation(LIVE_CODE), GUARD)).toBe(true);
  });

  it("compares case-insensitively, since EIP-55 casing differs by source", () => {
    expect(isDelegatedTo(parseDelegation(LIVE_CODE), GUARD.toLowerCase() as Address)).toBe(true);
  });

  it("refuses a delegation to a different implementation", () => {
    const rival = "0xef0100000000000000000000000000000000000dead";
    expect(isDelegatedTo(parseDelegation(rival), GUARD)).toBe(false);
  });

  it("is false when there is no delegation or no configured guard", () => {
    expect(isDelegatedTo(parseDelegation("0x"), GUARD)).toBe(false);
    expect(isDelegatedTo(parseDelegation(LIVE_CODE), undefined)).toBe(false);
  });
});

describe("describeGuard", () => {
  it("confirms the slot the live deployment actually returns", () => {
    expect(GUARD_STORAGE_SLOT).toBe(
      "0x723bc0536d6998736ca58b10278e77528d6552c6336394144a42647181e0f200",
    );
    expect(describeGuard(GUARD_STORAGE_SLOT).kind).toBe("confirmed");
  });

  it("reports a different slot as another implementation, not as a failure", () => {
    const other = `0x${"11".repeat(32)}` as Hex;
    expect(describeGuard(other).kind).toBe("other");
  });

  it("reports no answer distinctly from a wrong answer", () => {
    // These need different copy: one is "delegated elsewhere", the other is "could not tell".
    expect(describeGuard(undefined).kind).toBe("unanswered");
  });

  it("compares case-insensitively", () => {
    expect(describeGuard(GUARD_STORAGE_SLOT.toUpperCase().replace("0X", "0x") as Hex).kind).toBe(
      "confirmed",
    );
  });
});

describe("delegationCopy", () => {
  it("only claims enforcement when the guard is confirmed", () => {
    const copy = delegationCopy(parseDelegation(LIVE_CODE), describeGuard(GUARD_STORAGE_SLOT));
    expect(copy).toMatch(/checked against an approved pin/);
  });

  it("names the silent-handover hazard when delegated elsewhere", () => {
    // The whole point. This is the state where storage looks fine and nothing is enforcing.
    const copy = delegationCopy(
      parseDelegation(LIVE_CODE),
      describeGuard(`0x${"11".repeat(32)}` as Hex),
    );
    expect(copy).toMatch(/unenforced/);
    expect(copy).toMatch(/code, not storage/);
  });

  it("never claims enforcement for an unconfirmed account", () => {
    const cases = [
      delegationCopy(parseDelegation("0x"), describeGuard(undefined)),
      delegationCopy(parseDelegation(`0x${"60".repeat(50)}`), describeGuard(undefined)),
      delegationCopy(parseDelegation(LIVE_CODE), describeGuard(undefined)),
      delegationCopy(parseDelegation(LIVE_CODE), describeGuard(`0x${"11".repeat(32)}` as Hex)),
    ];

    for (const copy of cases) {
      expect(copy, copy).not.toMatch(/checked against an approved pin/);
    }
  });

  it("does not tell a contract to delegate itself", () => {
    const copy = delegationCopy(parseDelegation(`0x${"60".repeat(50)}`), describeGuard(undefined));
    expect(copy).toMatch(/cannot carry a guard/);
  });
});
