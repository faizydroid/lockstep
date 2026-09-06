/**
 * What actually needs a person, in the order it needs them.
 *
 * ## Why this is a module and not a component
 *
 * It is the dashboard's whole argument, and it is arithmetic. The rule the research is unanimous about for
 * this class of product is exception-first: the resting state should be quiet, and only what needs attention
 * should be loud. That is a claim about ranking, and ranking belongs somewhere it can be tested against
 * fixtures rather than asserted about a screenshot.
 *
 * ## Why a queue and not a health score
 *
 * The dashboard already had four ratios in four equal tiles — integrity, bond coverage, clean publishers,
 * equivocations — and every one of them shouted at the same volume, which is the single most common failure
 * in a security dashboard. A reader could look at that grid and still not know whether they were supposed to
 * do anything. Those ratios are still worth showing; they are just not the answer to the question a returning
 * reader opens the page with.
 *
 * ## What is deliberately not in here
 *
 * Refused calls. A refusal is the system working, already resolved, and there is nothing for the reader to
 * decide about one — it belongs in the activity feed as history. Putting it in a queue would mean an item
 * that cannot be cleared, which is how a queue stops being believed.
 *
 * Uncollateralised live pins, for the same reason: a reader cannot bond someone else's pin. It is a fact
 * about the registry, so it sits with the registry's other facts.
 */

import { formatBps, formatNative, shortAddress } from "./format";
import type { Snapshot } from "./model";
import { displayName } from "./untrusted";

/** Severity, and therefore order. Lower sorts first. */
const RANK = { equivocation: 0, widened: 1, narrowed: 2 } as const;

export type DecisionKind = keyof typeof RANK;

export interface Decision {
  /** Stable across renders, so React keys do not shuffle when the snapshot refreshes. */
  readonly id: string;
  readonly kind: DecisionKind;
  /** An imperative naming the outcome, not the feature. "Review what changed in x", not "Open drift". */
  readonly title: string;
  /** One sentence of why, specific enough to act on without opening the page. */
  readonly detail: string;
  readonly href: string;
  /** Which semantic hue carries it. Never the only signal — every row is also a sentence. */
  readonly tone: "equivocated" | "attention" | "pinned";
}

/**
 * The queue.
 *
 * Equivocation outranks drift because it is a proven lie by a publisher rather than a change that might be
 * benign, and because it is the one item with a reward attached: whoever proves it keeps a share of the bond.
 * Narrowing drift sorts last and is included rather than hidden — it still means the pin no longer matches
 * and calls are being refused, so a reader who sees nothing at all would be misled about why a skill stopped
 * working.
 */
export function decisionsFor(snapshot: Snapshot): readonly Decision[] {
  const out: Decision[] = [];

  for (const publisher of snapshot.publishers) {
    if (!publisher.hasEquivocated) continue;
    out.push({
      id: `equivocation:${publisher.address}`,
      kind: "equivocation",
      title: `Prove the equivocation by ${shortAddress(publisher.address)}`,
      detail: `This publisher has two live pins under one version string, which is provable on chain. Whoever submits the proof keeps ${formatBps(snapshot.pricing.challengerRewardBps)} of the slashed bond.`,
      href: "/publishers",
      tone: "equivocated",
    });
  }

  for (const skill of snapshot.drifted) {
    const name = displayName(skill.skillName);
    const added = skill.diff.added.length;
    const highRisk = skill.diff.added.filter((capability) => capability.highRisk).length;
    const raised = skill.diff.ceilingAfter > skill.diff.ceilingBefore;

    if (skill.diff.widened) {
      /*
       * The detail names what widened rather than saying "review the changes".
       *
       * A reader deciding whether to open this needs to know whether the new version can move money the
       * approved one could not. "2 new capabilities, 1 of them high risk" answers that; "this skill has
       * changed" makes them click to find out, which is the interruption the whole `widened` distinction
       * exists to avoid spending carelessly.
       */
      const parts: string[] = [];
      if (added > 0) {
        parts.push(
          `${added} new capabilit${added === 1 ? "y" : "ies"}${highRisk > 0 ? `, ${highRisk} of them high risk` : ""}`,
        );
      }
      if (raised) {
        parts.push(
          `the native-value ceiling rose from ${formatNative(skill.diff.ceilingBefore)} to ${formatNative(skill.diff.ceilingAfter)}`,
        );
      }

      out.push({
        id: `widened:${skill.approvedPinId}`,
        kind: "widened",
        title: `Review what changed in ${name}`,
        detail: `The version on disk can do things the one you approved could not: ${parts.join(", and ")}. Every fund-moving call from it is refused until you decide again.`,
        href: "/drift",
        tone: "attention",
      });
      continue;
    }

    out.push({
      id: `narrowed:${skill.approvedPinId}`,
      kind: "narrowed",
      title: `${name} changed, and only narrowed`,
      detail: `Nothing the new version can do is outside what you already approved${skill.diff.removed.length > 0 ? `, and it dropped ${skill.diff.removed.length} capabilit${skill.diff.removed.length === 1 ? "y" : "ies"}` : ""}. The hash still differs, so calls are still refused until it is re-approved.`,
      href: "/drift",
      tone: "pinned",
    });
  }

  return out.sort((a, b) => RANK[a.kind] - RANK[b.kind]);
}

/**
 * The one sentence at the top of the dashboard.
 *
 * Counts things needing a decision, not things that changed. "2 pending approvals" and "one of these can
 * move money the version you approved could not" are the same number and different products; the second is
 * the one a reader reads carefully.
 */
export function queueHeadline(decisions: readonly Decision[]): string {
  if (decisions.length === 0) return "Nothing needs your decision.";

  const n = decisions.length;
  return `${n} thing${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} your decision.`;
}
