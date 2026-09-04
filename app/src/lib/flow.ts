/**
 * Which stage of the first-run flow a reader is in.
 *
 * ## The flow
 *
 *   landing     the argument, and an invitation to connect
 *   profile     a local label, so the product knows what to show first
 *   onboarding  the checklist, with what is already true already ticked
 *   ready       the dashboard and everything else
 *
 * ## Why this is a first-run flow and not authentication
 *
 * It cannot be authentication. This is a static export with no server, so there is nothing to
 * authenticate against and nothing that could enforce a gate anyway -- every route is a file that a
 * reader can request directly. Calling it a login would be claiming a property the architecture does not
 * have, which is the one kind of lie this product cannot tell.
 *
 * What it is instead: an ordering. A first-time reader gets the argument before the instrument, is asked
 * who they are so the checklist can be relevant, and lands on the dashboard with context. That is worth
 * having on its own merits, and it is honest about what it is.
 *
 * ## Why the order of the checks matters
 *
 * `stageFor` is deliberately not a simple cascade, and each departure is a decision:
 *
 * A finished flow stays finished even if the wallet disconnects. The obvious cascade -- "not connected,
 * therefore landing" -- would throw a returning reader back to the marketing page every time their wallet
 * locked itself, which is both hostile and wrong, since the profile that made them a returning reader is
 * still there.
 *
 * Skipping is durable. A reader who chose to look around is not re-asked on the next navigation. They can
 * still create a profile later from the account page; the flow simply stops steering them.
 *
 * Connecting is what advances past the landing page, because it is the only step in the sequence backed by
 * something observable rather than by a stored tick. That is the same rule `lib/quickstart.ts` runs on.
 */

import type { Profile } from "./settings";

export type Stage = "landing" | "profile" | "onboarding" | "ready";

/** Where each stage lives. `ready` has no route of its own; it means "wherever you were going". */
export const STAGE_ROUTE = {
  landing: "/",
  profile: "/start/profile",
  onboarding: "/start/onboarding",
} as const;

/** Every route that belongs to the flow, so the gate can tell a stage page from a product page. */
export const FLOW_ROUTES: readonly string[] = ["/", STAGE_ROUTE.profile, STAGE_ROUTE.onboarding];

export interface FlowInput {
  /** A wallet is connected. The one input here that is not a stored preference. */
  readonly connected: boolean;
  readonly profile: Profile | undefined;
  readonly onboardingAcknowledged: boolean;
  readonly skippedSetup: boolean;
}

export function stageFor(input: FlowInput): Stage {
  /*
   * A completed flow is completed. Checked first, and before `connected`, so a locked or swapped wallet
   * cannot demote a returning reader to the landing page.
   */
  if (input.profile !== undefined && input.onboardingAcknowledged) return "ready";

  // A durable choice, not a per-visit one.
  if (input.skippedSetup) return "ready";

  if (!input.connected) return "landing";

  if (input.profile === undefined) return "profile";

  return "onboarding";
}

/**
 * Whether a reader in `stage` should be moved off `pathname`.
 *
 * Returns the route to send them to, or undefined to leave them alone. Two rules, and the second is the
 * one that keeps this from becoming a cage:
 *
 * A reader mid-flow who asks for a product page is steered back to their stage, because the flow has an
 * order and skipping the middle of it is how someone ends up on a dashboard they cannot read.
 *
 * A reader who has finished is pushed off the stage pages, because a profile form that reappears after it
 * is filled in reads as though the save failed. The landing page is exempt: it is a real page with a real
 * argument on it, and someone who has finished the flow is allowed to go back and read it.
 */
export function redirectFor(stage: Stage, pathname: string): string | undefined {
  if (stage === "ready") {
    if (pathname === STAGE_ROUTE.profile || pathname === STAGE_ROUTE.onboarding) return "/dashboard";
    return undefined;
  }

  const target = STAGE_ROUTE[stage];
  return pathname === target ? undefined : target;
}
