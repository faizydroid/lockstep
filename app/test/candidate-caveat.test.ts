import { describe, expect, it } from "vitest";
import type { Address } from "viem";

import { describeCandidateWeakness } from "../src/lib/chain";
import type { ReviewerCheck } from "../src/lib/model";

/**
 * The caveat is the honest part of the reviewer panel, so it gets tested like a feature.
 *
 * A Sybil filter that excludes nobody renders as a column of green pills, which reads as the filter
 * working when in fact it has been given nothing to reject. On the live testnet deployment this is
 * the actual situation -- the delegated account and the only publisher are the same address -- so
 * the caveat is not a defensive edge case, it is the state the deployed dashboard is in. If this
 * logic regresses, the interface starts overclaiming, which is the specific failure the whole
 * product is about.
 */

const ACCOUNT = "0x209C903f68f169C8e654e0C3C91cAdc4C4A4aFF2" as Address;
const OTHER = "0x000000000000000000000000000000000000dEaD" as Address;
const PUBLISHER = "0x66eA9BF25f8FE81f6b1c4a4bDAe0e0FdE7a1B0Cf" as Address;

const check = (candidate: Address, eligible: boolean): ReviewerCheck => ({
  candidate,
  eligible,
  basis: candidate === ACCOUNT ? "account" : "publisher",
});

describe("describeCandidateWeakness", () => {
  it("names self-review when the account is also a publisher and nothing was excluded", () => {
    const caveat = describeCandidateWeakness(
      [check(ACCOUNT, true)],
      { account: ACCOUNT },
      [{ address: ACCOUNT }],
    );

    expect(caveat).toBeDefined();
    expect(caveat).toMatch(/vouching for its own release/);
    expect(caveat).toMatch(/not independent review/);
  });

  it("says the filter excluded nobody when every candidate passed", () => {
    const caveat = describeCandidateWeakness(
      [check(ACCOUNT, true), check(PUBLISHER, true)],
      { account: ACCOUNT },
      [{ address: PUBLISHER }],
    );

    expect(caveat).toMatch(/came back eligible/);
    expect(caveat).toMatch(/removes nothing looks identical to no filter/);
  });

  it("stays quiet once the filter actually excludes someone and no self-review is involved", () => {
    // The only case that needs no caveat: the rule discriminated, on parties that are not the
    // subject. Adding a warning here would train a reader to ignore all of them.
    const caveat = describeCandidateWeakness(
      [check(PUBLISHER, true), check(OTHER, false)],
      { account: OTHER },
      [{ address: PUBLISHER }],
    );

    expect(caveat).toBeUndefined();
  });

  it("still flags self-review when the filter did exclude someone else", () => {
    const caveat = describeCandidateWeakness(
      [check(ACCOUNT, true), check(OTHER, false)],
      { account: ACCOUNT },
      [{ address: ACCOUNT }],
    );

    expect(caveat).toMatch(/partly a statement about itself/);
  });

  it("compares addresses case-insensitively, since checksummed and lowercase hex differ", () => {
    // The same address from configuration and from a log routinely arrives in different casings.
    // A case-sensitive comparison would miss the self-review and the panel would overclaim.
    const caveat = describeCandidateWeakness(
      [check(ACCOUNT, true)],
      { account: ACCOUNT.toLowerCase() as Address },
      [{ address: ACCOUNT.toUpperCase().replace("0X", "0x") as Address }],
    );

    expect(caveat).toMatch(/vouching for its own release/);
  });

  it("has nothing to say about an empty candidate list", () => {
    expect(describeCandidateWeakness([], { account: ACCOUNT }, [{ address: ACCOUNT }])).toBeUndefined();
  });

  it("does not claim self-review when no account is configured", () => {
    const caveat = describeCandidateWeakness([check(PUBLISHER, true)], {}, [{ address: PUBLISHER }]);

    expect(caveat).toMatch(/came back eligible/);
    expect(caveat).not.toMatch(/its own release/);
  });
});
