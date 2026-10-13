/**
 * Reads that make the log-derived parts of a snapshot honest about time and about what the chain says now.
 *
 * Kept out of `chain.ts` so they can be tested with a stand-in client; that file builds the real one.
 */
import type { Address, PublicClient } from "viem";

import { lockstepGuardAbi } from "./abi";
import type { Approval, Pin } from "./model";

/**
 * Unix seconds for each block number, for at most `cap` distinct blocks.
 *
 * A log carries a block number and nothing else about time. The dashboard stored that number where the
 * model says "unix seconds", so the Approvals page printed an approval made at block 62,008,822 as a day in
 * 1971 and every execution in the activity feed the same way. A block that cannot be read, or one past the
 * cap, is left out of the map and the caller shows "time unknown", which is true, instead of a wrong date.
 *
 * The newest blocks are kept when the cap bites: the recent past is what a reader is looking for.
 */
export async function blockTimestamps(
  client: Pick<PublicClient, "getBlock">,
  blocks: readonly bigint[],
  cap = 24,
): Promise<ReadonlyMap<bigint, bigint>> {
  const distinct = [...new Set(blocks)].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)).slice(0, cap);
  const entries = await Promise.all(
    distinct.map(async (blockNumber) => {
      try {
        const block = await client.getBlock({ blockNumber });
        return [blockNumber, block.timestamp] as const;
      } catch {
        return undefined;
      }
    }),
  );
  return new Map(entries.filter((e): e is readonly [bigint, bigint] => e !== undefined));
}

/**
 * Approvals as the account itself reports them.
 *
 * `fromLogs` is every `PinApproved` not later undone by a `PinUnapproved` inside the scanned window, so an
 * approval made after the window is missing and one withdrawn after it is still listed. The account can be
 * asked directly: `isPinApproved(pinId)` is one `eth_call` and is true exactly when the guard would honour
 * the pin now, whenever it was approved. That is asked for every pin the page knows about and wins over the
 * logs where it answers.
 *
 * Falls back to the logs when the account cannot answer at all (no delegation, or the endpoint failed),
 * and for any single pin whose call failed. An approval for a pin outside `pins` cannot be asked about by
 * id here and is kept as the logs gave it.
 */
export async function confirmApprovals(
  client: Pick<PublicClient, "readContract">,
  account: Address,
  pins: readonly Pin[],
  fromLogs: readonly Approval[],
): Promise<readonly Approval[]> {
  if (pins.length === 0) return fromLogs;

  const answers = await Promise.allSettled(
    pins.map((pin) =>
      client.readContract({
        address: account,
        abi: lockstepGuardAbi,
        functionName: "isPinApproved",
        args: [pin.pinId],
      }),
    ),
  );
  if (answers.every((a) => a.status === "rejected")) return fromLogs;

  const logged = new Map(fromLogs.map((a) => [a.pinId.toLowerCase(), a] as const));
  const known = new Set(pins.map((p) => p.pinId.toLowerCase()));
  const out: Approval[] = [];

  pins.forEach((pin, i) => {
    const key = pin.pinId.toLowerCase();
    const answer = answers[i]!;
    const fromLog = logged.get(key);
    if (answer.status === "rejected") {
      if (fromLog !== undefined) out.push(fromLog);
      return;
    }
    if (answer.value === true) {
      // approvedAt 0 means "approved now, when unknown": the account can say that it is, not when it was.
      out.push(fromLog ?? { account, pinId: pin.pinId, approvedAt: 0n });
    }
  });

  for (const approval of fromLogs) {
    if (!known.has(approval.pinId.toLowerCase())) out.push(approval);
  }
  return out;
}
