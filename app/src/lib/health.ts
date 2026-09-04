/**
 * The numbers the scoreboard shows, derived from a snapshot.
 *
 * This file exists to keep one promise: every figure presented in the gamified header is something
 * the chain actually says. Duolingo's header is XP, a streak and a league, and all three are invented
 * quantities that the product is free to define however it likes. This app does not have that freedom
 * -- it reports on money that was or was not allowed to move, and a number that looks like a score but
 * is not measuring anything is worse than no number at all.
 *
 * What is deliberately NOT here, and why:
 *
 *   XP and levels. There is nothing to accumulate. Approving a skill is not an achievement and
 *   pretending it earns points would encourage exactly the click-through behaviour the product
 *   exists to prevent.
 *
 *   A day streak counted from refused calls. This one is genuinely tempting because it maps so well
 *   onto the Duolingo mechanic, and it is unshippable: the guard emits no event when it refuses a
 *   call, because a log written before a revert is rolled back. Refusals are reconstructed from
 *   traces, so the list is sparse by construction and an empty list means "nothing was observed",
 *   not "nothing happened". A streak counter built on it would read as a safety record while
 *   actually measuring whether anyone was running a trace-capable node. See BlockedAttempt.
 *
 *   A publisher trust score. Combining bond size and slash history into one number implies a
 *   weighting this project has no basis for, and would let a well-capitalised publisher buy a good
 *   grade. Bond and slash count are shown separately and left for the reader to weigh.
 *
 * What survived is four measures, each of which is a ratio or count over data the registry emits.
 */

import type { Snapshot } from "./model";

export interface Health {
  /**
   * Approved skills whose bytes still match what was approved, over all approved skills.
   *
   * The headline figure, and the closest honest analogue to a completion ring: it genuinely goes
   * down when something is wrong and back up when it is resolved. 1 when nothing has drifted.
   */
  readonly integrity: number;
  readonly approvedCount: number;
  readonly driftedCount: number;

  /**
   * Live pins carrying a bond, over all live pins.
   *
   * A pin with no bond is still enforced -- the hash check does not care about collateral -- but
   * there is nothing to slash if the publisher equivocates. So this measures how much of what is
   * approved is backed by something at stake, which is a real distinction and not a score.
   */
  readonly bondCoverage: number;
  readonly bondedCount: number;
  readonly liveCount: number;

  /** Publishers with no slash on record, over all known publishers. */
  readonly cleanPublishers: number;
  readonly publisherCount: number;

  /** Publishers caught shipping conflicting bytes under one version string. */
  readonly equivocations: number;

  /**
   * The single verdict, for Guard's expression and the headline copy.
   *
   * Severity order, worst first: an equivocation outranks drift, because a publisher who has
   * contradicted themselves is a different class of problem from one release going stale.
   */
  readonly verdict: "settled" | "alarmed" | "blocked" | "watching";
}

/** Guards a ratio whose denominator can legitimately be zero on a fresh registry. */
function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 1;
  return Math.max(0, Math.min(1, numerator / denominator));
}

export function healthOf(snapshot: Snapshot): Health {
  const approvedCount = snapshot.approvals.length;
  const driftedCount = snapshot.drifted.length;

  const live = snapshot.pins.filter((p) => p.state === "bonded" || p.state === "pinned");
  const bondedCount = live.filter((p) => p.requiredBond > 0n).length;

  const equivocations = snapshot.publishers.filter((p) => p.hasEquivocated).length;
  const cleanPublishers = snapshot.publishers.filter(
    (p) => p.slashCount === 0 && !p.hasEquivocated,
  ).length;

  /*
   * Drift is counted against approvals, not against pins.
   *
   * A pin nobody approved cannot have drifted from anything -- drift is defined relative to what an
   * account agreed to run. Dividing by the pin count instead would dilute the figure with releases
   * that are simply unused, making a real problem look smaller as the registry grows.
   */
  const integrity = ratio(Math.max(0, approvedCount - driftedCount), approvedCount);

  const verdict: Health["verdict"] =
    equivocations > 0
      ? "blocked"
      : driftedCount > 0
        ? "alarmed"
        : approvedCount > 0
          ? "settled"
          : "watching";

  return {
    integrity,
    approvedCount,
    driftedCount,
    bondCoverage: ratio(bondedCount, live.length),
    bondedCount,
    liveCount: live.length,
    cleanPublishers,
    publisherCount: snapshot.publishers.length,
    equivocations,
    verdict,
  };
}

/**
 * The one-line summary Guard says.
 *
 * Phrased as a statement of fact rather than praise. "Everything matches" is checkable; "Great job,
 * you're all caught up!" is the voice of a product congratulating you for existing, and it would sit
 * badly next to a number that can mean money did not move.
 */
export function verdictCopy(health: Health): string {
  if (health.equivocations > 0) {
    const n = health.equivocations;
    return `${n} publisher${n === 1 ? " has" : "s have"} shipped conflicting bytes under one version string and lost their bond. Pins from ${n === 1 ? "that publisher" : "those publishers"} no longer vouch for anything.`;
  }

  if (health.driftedCount > 0) {
    const n = health.driftedCount;
    return `${n} approved skill${n === 1 ? "" : "s"} no longer match${n === 1 ? "es" : ""} the bytes you approved. Every fund-moving call from ${n === 1 ? "it" : "them"} is being refused until you review the change.`;
  }

  if (health.approvedCount === 0) {
    return "Nothing is approved yet. Pin a skill version and this becomes the record of what your agent is allowed to spend against.";
  }

  return `All ${health.approvedCount} approved skill${health.approvedCount === 1 ? "" : "s"} still match the bytes you approved. Calls settle.`;
}
