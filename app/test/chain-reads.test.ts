/**
 * The parts of a snapshot that come from logs, and what happens when the logs do not reach.
 *
 * Capabilities, approvals and executions are read from events in one fixed block window, because a public
 * RPC serves a hundred blocks a request. Three things went wrong with that, each of them a reassuring wrong
 * answer on the page a judge opens first:
 *
 *   - A pin whose capability events fall outside the window listed no capabilities, so it read "0
 *     capabilities", was priced as nearly empty, and the badge preview said green for a pin that may call
 *     `approve`. `getPin` reports both counts regardless of the window.
 *   - An approval made after the window did not appear, and one withdrawn after it still did. The account
 *     can be asked.
 *   - A log carries a block number and the model wants seconds, so an approval was printed as a date in 1971.
 */
import { describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";

import { capabilityCounts, capabilityNoun, partialListNote } from "../src/lib/capability-counts";
import { blockTimestamps, confirmApprovals } from "../src/lib/chain-reads";
import { bondBreakdown } from "../src/lib/bond";
import { timeAgo } from "../src/lib/format";
import type { Approval, BondPricing, Capability, Pin } from "../src/lib/model";

const ACCOUNT = "0x209C903f68f169C8e654e0C3C91cAdc4C4A4aFF2" as Address;
const id = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;

const cap = (selector: Hex, highRisk: boolean): Capability => ({
  target: "0x1111111111111111111111111111111111111111",
  selector,
  label: selector,
  highRisk,
});

function pin(n: number, extra: Partial<Pin> = {}): Pin {
  return {
    pinId: id(n),
    publisher: "0xcc71E1f66CA325A9D3dEC74b2AA94CDF870194Dc",
    skillHash: id(n + 1000),
    versionId: id(n + 2000),
    maxValuePerBatch: 0n,
    requiredBond: 1_150_000_000n,
    publishedAt: 1_760_000_000n,
    slashed: false,
    capabilities: [],
    state: "bonded",
    ...extra,
  };
}

const approval = (n: number, approvedAt = 1_760_000_100n): Approval => ({ account: ACCOUNT, pinId: id(n), approvedAt });

const PRICING: BondPricing = {
  baseBond: 100_000_000n,
  perCapabilityBond: 25_000_000n,
  highRiskBond: 500_000_000n,
  nativeValueBond: 500_000_000n,
  challengerRewardBps: 5000n,
  unbondingDelay: 604_800n,
  bondAssetDecimals: 6,
  bondAssetSymbol: "mAUSD",
};

describe("capabilityCounts", () => {
  it("uses what the registry declares when the log window recovered none of the list", () => {
    // The live pin as the dashboard read it before: two high-risk capabilities declared, none listed.
    const counts = capabilityCounts(pin(1, { declaredCapabilities: 2, declaredHighRisk: 2 }));
    expect(counts).toEqual({ total: 2, highRisk: 2, listed: 0, complete: false });
  });

  it("counts a complete list as complete", () => {
    const counts = capabilityCounts(
      pin(1, { capabilities: [cap("0x095ea7b3", true), cap("0xa9059cbb", true)], declaredCapabilities: 2, declaredHighRisk: 2 }),
    );
    expect(counts).toEqual({ total: 2, highRisk: 2, listed: 2, complete: true });
  });

  it("falls back to the list when nothing was declared, as with fixtures", () => {
    const counts = capabilityCounts(pin(1, { capabilities: [cap("0x095ea7b3", true), cap("0x12345678", false)] }));
    expect(counts).toEqual({ total: 2, highRisk: 1, listed: 2, complete: true });
  });

  it("never reports fewer than the list holds", () => {
    const counts = capabilityCounts(pin(1, { capabilities: [cap("0x095ea7b3", true)], declaredCapabilities: 0, declaredHighRisk: 0 }));
    expect(counts.total).toBe(1);
    expect(counts.highRisk).toBe(1);
  });

  it("says why the list is partial, and says nothing when it is not", () => {
    const partial = partialListNote(capabilityCounts(pin(1, { capabilities: [cap("0x095ea7b3", true)], declaredCapabilities: 3, declaredHighRisk: 2 })));
    expect(partial).toMatch(/Showing 1 of 3/);
    expect(partial).toMatch(/block window/);
    expect(partialListNote(capabilityCounts(pin(1)))).toBeUndefined();
  });

  it("pluralises", () => {
    expect(capabilityNoun(1)).toBe("capability");
    expect(capabilityNoun(0)).toBe("capabilities");
    expect(capabilityNoun(2)).toBe("capabilities");
  });

  it("prices a bond from the declared counts, so the breakdown matches the chain for a partial list", () => {
    const partial = pin(1, { declaredCapabilities: 2, declaredHighRisk: 2 });
    const breakdown = bondBreakdown(partial, PRICING);
    // base 100 + 2 * 25 + 2 * 500 = 1,150 mAUSD (6 decimals)
    expect(breakdown.total).toBe(1_150_000_000n);
    expect(breakdown.matchesChain).toBe(true);
  });
});

describe("confirmApprovals", () => {
  const client = (answers: Record<string, boolean | Error>) => ({
    readContract: vi.fn(async ({ args }: { args: readonly [Hex] }) => {
      const answer = answers[args[0]];
      if (answer instanceof Error) throw answer;
      if (answer === undefined) throw new Error("zero data");
      return answer;
    }),
  });

  it("finds an approval the logs missed, and says it is approved without claiming when", async () => {
    const out = await confirmApprovals(client({ [id(1)]: true }) as never, ACCOUNT, [pin(1)], []);
    expect(out).toEqual([{ account: ACCOUNT, pinId: id(1), approvedAt: 0n }]);
  });

  it("drops an approval the logs show but the account no longer holds", async () => {
    const out = await confirmApprovals(client({ [id(1)]: false }) as never, ACCOUNT, [pin(1)], [approval(1)]);
    expect(out).toEqual([]);
  });

  it("keeps the logged time for an approval the account confirms", async () => {
    const out = await confirmApprovals(client({ [id(1)]: true }) as never, ACCOUNT, [pin(1)], [approval(1, 1_760_000_555n)]);
    expect(out).toEqual([approval(1, 1_760_000_555n)]);
  });

  it("falls back to the logs when the account cannot answer at all (no delegation)", async () => {
    const out = await confirmApprovals(client({}) as never, ACCOUNT, [pin(1), pin(2)], [approval(1)]);
    expect(out).toEqual([approval(1)]);
  });

  it("falls back to the log for a single pin whose call failed, and trusts the others", async () => {
    const out = await confirmApprovals(
      client({ [id(1)]: new Error("timeout"), [id(2)]: true, [id(3)]: false }) as never,
      ACCOUNT,
      [pin(1), pin(2), pin(3)],
      [approval(1), approval(3)],
    );
    expect(out.map((a) => a.pinId).sort()).toEqual([id(1), id(2)].sort());
  });

  it("keeps an approval for a pin the page does not know, since it cannot be asked about by id", async () => {
    const out = await confirmApprovals(client({ [id(1)]: true }) as never, ACCOUNT, [pin(1)], [approval(9)]);
    expect(out.map((a) => a.pinId).sort()).toEqual([id(1), id(9)].sort());
  });

  it("reads nothing when there are no pins", async () => {
    const c = client({});
    expect(await confirmApprovals(c as never, ACCOUNT, [], [approval(1)])).toEqual([approval(1)]);
    expect(c.readContract).not.toHaveBeenCalled();
  });
});

describe("blockTimestamps", () => {
  const chain = (times: Record<string, bigint>) => ({
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => {
      const t = times[String(blockNumber)];
      if (t === undefined) throw new Error("block not found");
      return { timestamp: t };
    }),
  });

  it("maps each block to its time, reading each distinct block once", async () => {
    const c = chain({ "100": 1_000n, "200": 2_000n });
    const out = await blockTimestamps(c as never, [100n, 200n, 100n]);
    expect(out.get(100n)).toBe(1_000n);
    expect(out.get(200n)).toBe(2_000n);
    expect(c.getBlock).toHaveBeenCalledTimes(2);
  });

  it("leaves out a block that cannot be read, rather than inventing a time", async () => {
    const out = await blockTimestamps(chain({ "100": 1_000n }) as never, [100n, 300n]);
    expect(out.has(300n)).toBe(false);
    expect(out.get(100n)).toBe(1_000n);
  });

  it("keeps the newest blocks when the cap bites", async () => {
    const times = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1), BigInt(i + 1) * 10n]));
    const out = await blockTimestamps(chain(times) as never, Array.from({ length: 10 }, (_, i) => BigInt(i + 1)), 3);
    expect([...out.keys()].sort((a, b) => Number(a - b))).toEqual([8n, 9n, 10n]);
  });
});

describe("timeAgo for a time that is not known", () => {
  it("does not print the epoch, or a block number as a 1971 date", () => {
    expect(timeAgo(0n)).toBe("time unknown");
    expect(timeAgo(-5n)).toBe("time unknown");
  });

  it("still prints a real time", () => {
    const now = 1_760_000_600_000;
    expect(timeAgo(1_760_000_000n, now)).toBe("10m ago");
  });
});
