/**
 * How many capabilities a pin has, as the registry reports it rather than as the log window recovered it.
 *
 * Every place that printed `pin.capabilities.length`, filtered it for high risk, or priced a bond from it
 * was reading the list the logs happened to yield. For a pin whose `CapabilityDeclared` events fall outside
 * the scanned window that list is empty, so the dashboard said "0 capabilities", priced the bond as base
 * only, and rendered the badge green for a pin that may call `approve`. A reassuring wrong answer is the
 * failure this project exists to prevent, so the counts come from `getPin` whenever it supplied them.
 */
import type { Pin } from "./model";

export interface CapabilityCounts {
  /** What the pin declares. */
  readonly total: number;
  /** How many of those are high risk. */
  readonly highRisk: number;
  /** How many are listed with their target and function. */
  readonly listed: number;
  /** True when every declared capability is listed. False means the list below the counts is partial. */
  readonly complete: boolean;
}

export function capabilityCounts(pin: Pin): CapabilityCounts {
  const listed = pin.capabilities.length;
  const listedHighRisk = pin.capabilities.filter((c) => c.highRisk).length;
  const total = Math.max(pin.declaredCapabilities ?? listed, listed);
  const highRisk = Math.max(pin.declaredHighRisk ?? listedHighRisk, listedHighRisk);
  return { total, highRisk, listed, complete: listed >= total };
}

/** "3 capabilities", "1 capability". */
export function capabilityNoun(count: number): string {
  return count === 1 ? "capability" : "capabilities";
}

/** The note shown beside a partial list. Names the reason, because "missing" alone reads as a bug. */
export function partialListNote(counts: CapabilityCounts): string | undefined {
  if (counts.complete) return undefined;
  return (
    `Showing ${counts.listed} of ${counts.total}. The registry says this pin declares ${counts.total}, ` +
    `but the events for the rest fall outside the block window this page reads.`
  );
}
