import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readConfig } from "../src/lib/chain";

/**
 * The Lens is optional, and its optionality has to survive configuration mistakes.
 *
 * Two failure modes are specifically worth locking down, because both produce a dashboard that
 * looks configured while reading the wrong thing:
 *
 *   - A zero address treated as a deployment. `isAddressish` already rejects it for the registry;
 *     these assert the Lens goes through the same gate rather than a looser one.
 *   - An unset agent id defaulting to zero. ERC-8004 agent ids are ERC-721 token ids, so zero is
 *     not one. A `?? 0n` default would make every read ask about agent 0 and report "no
 *     reputation" as though it had asked the right question.
 */
describe("readConfig, for the Lens", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_LOCKSTEP_LENS;
    delete process.env.NEXT_PUBLIC_ERC8004_AGENT_ID;
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it("omits the lens when unset, rather than defaulting to an address", () => {
    expect(readConfig().lens).toBeUndefined();
  });

  it("reads a well-formed lens address", () => {
    process.env.NEXT_PUBLIC_LOCKSTEP_LENS = "0xEB0A033CfDD1e8393Ac512de0DEc36d6C9323Ebc";
    expect(readConfig().lens).toBe("0xEB0A033CfDD1e8393Ac512de0DEc36d6C9323Ebc");
  });

  it("rejects the zero address, which is the common way to look configured and not be", () => {
    process.env.NEXT_PUBLIC_LOCKSTEP_LENS = "0x0000000000000000000000000000000000000000";
    expect(readConfig().lens).toBeUndefined();
  });

  it("rejects malformed hex rather than passing it to viem", () => {
    for (const bad of ["0x1234", "not-an-address", "3338c4F5c8eEFeACF8e41d6ac47B63c466175664"]) {
      process.env.NEXT_PUBLIC_LOCKSTEP_LENS = bad;
      expect(readConfig().lens, bad).toBeUndefined();
    }
  });

  it("omits the agent id when unset, so nothing queries agent 0", () => {
    expect(readConfig().agentId).toBeUndefined();
  });

  it("treats zero and negative agent ids as unset, because neither is a token id", () => {
    for (const bad of ["0", "-1", "  ", ""]) {
      process.env.NEXT_PUBLIC_ERC8004_AGENT_ID = bad;
      expect(readConfig().agentId, JSON.stringify(bad)).toBeUndefined();
    }
  });

  it("reads a valid agent id, including one too large for a JS number", () => {
    process.env.NEXT_PUBLIC_ERC8004_AGENT_ID = "1";
    expect(readConfig().agentId).toBe(1n);

    const big = (2n ** 200n).toString();
    process.env.NEXT_PUBLIC_ERC8004_AGENT_ID = big;
    expect(readConfig().agentId).toBe(2n ** 200n);
  });

  it("drops an unparseable agent id instead of throwing", () => {
    process.env.NEXT_PUBLIC_ERC8004_AGENT_ID = "1.5";
    expect(readConfig().agentId).toBeUndefined();
  });
});
