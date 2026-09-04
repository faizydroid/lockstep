/**
 * The quickstart, derived from real state rather than from a stored checklist.
 *
 * ## Why the steps are detected instead of ticked
 *
 * The usual pattern is a list of checkboxes the product marks off as you click through it, and the
 * usual advice attached to it is to never start a user at zero — the car-wash study, where a ten-stamp
 * card with two stamps pre-filled was completed at roughly twice the rate of an eight-stamp card
 * requiring the same work. It works because progress you can see creates momentum.
 *
 * Two of those stamps were free, though, and that is the part this app cannot copy. A product whose
 * entire argument is the difference between a claim and a reading does not get to open with a
 * motivational fiction. Credit for work nobody did is a small lie in the one place it is most
 * expensive.
 *
 * So the steps are **conditions on observable state**, and the reason the list never starts at zero is
 * that the first condition is genuinely already true: arriving on a configured dashboard means you are
 * reading a live registry. That is the honest version of the same idea. The momentum is real because
 * the progress is.
 *
 * The consequence worth noticing is that progress can go **down** — disconnect a wallet and the
 * enforcement step stops being satisfied, because it stopped being true. A stored checklist could
 * never do that, and would happily tell someone their account was set up after they changed accounts.
 *
 * ## Why the count is not shown until something is done
 *
 * Revealing "0 of 5" before any value has landed reads as a demand. Typeform hides step counts on long
 * templates for the same reason. Here the first step is always satisfied on a configured build, so a
 * count is only ever shown alongside evidence that it is moving.
 */

import type { Snapshot } from "./model";

/** Route visits worth remembering, as step ids. Must match the `[a-z0-9-]{1,40}` shape storage allows. */
export const VISIT_STEPS = {
  "/drift": "saw-drift",
  "/bonds": "saw-bonds",
  "/badge": "saw-badge",
} as const;

/**
 * The id the refusal step is stored under.
 *
 * Satisfied two ways, and the difference matters. Arriving at `/drift` counts, which is true of someone
 * who landed there and scrolled past everything. Watching the settlement gate close counts too, and that
 * one required flipping a switch and waiting — it is the reader causing a refusal rather than being near
 * one. Both write this id, so the weaker path still gives credit and the stronger path is what the
 * diagram is for.
 */
export const REFUSAL_STEP = VISIT_STEPS["/drift"];

export interface QuickstartStep {
  readonly id: string;
  /** The outcome, not the feature. "See a call refused", not "Visit the drift page". */
  readonly title: string;
  /** What it is for, in one sentence a first-time reader can act on. */
  readonly why: string;
  readonly href?: string;
  readonly done: boolean;
  /**
   * True when the step cannot be completed in the browser at all.
   *
   * Approving and publishing are CLI-only by design, so presenting them as clickable would promise
   * something the app will not do. They are shown, marked, and explained instead of hidden — a
   * checklist that omitted them would describe a shorter product than the real one.
   */
  readonly cliOnly?: boolean;
}

export interface Quickstart {
  readonly steps: readonly QuickstartStep[];
  readonly done: number;
  readonly total: number;
  /** Whether to show a count at all. False before anything is satisfied. */
  readonly showCount: boolean;
  /** True once every step is satisfied, which is when the panel offers to get out of the way. */
  readonly complete: boolean;
}

/**
 * Builds the step list from the snapshot and the set of remembered visits.
 *
 * Pure, and takes the snapshot rather than reading a context, so the whole thing is testable without a
 * browser — which matters because the interesting cases are combinations of chain state that are
 * awkward to reach by clicking.
 */
export function quickstart(snapshot: Snapshot, visited: readonly string[]): Quickstart {
  const live = snapshot.source.kind === "chain";
  const seen = (id: string) => visited.includes(id);

  /*
   * Fixtures satisfy nothing.
   *
   * Caught by a test rather than by design: on a sample build the fixture approvals made "approve a
   * version" look done, so an unconfigured dashboard reported progress against work nobody had done —
   * precisely the motivational fiction this module exists to avoid, arrived at by accident.
   *
   * Visits are exempt, and the distinction is the one the whole app runs on. Opening `/drift` is
   * something the reader really did, whatever the data on it came from. An approval is a claim about
   * chain state, and there is no chain state on a sample build.
   */
  const onChain = (condition: boolean) => live && condition;

  const steps: readonly QuickstartStep[] = [
    {
      id: "read-registry",
      title: "Read a live registry",
      why: live
        ? "Done — every figure on this page came off chain, not from a fixture."
        : "This build is showing worked examples. Point it at a registry and the rest of these become real.",
      done: onChain(snapshot.pins.length > 0),
    },
    {
      id: VISIT_STEPS["/drift"],
      title: "See a call get refused",
      why: "The whole product in one screen: a publisher changed the bytes under an approved version, and the call stopped before funds moved.",
      href: "/drift",
      done: seen(VISIT_STEPS["/drift"]),
    },
    {
      id: "check-enforcement",
      title: "Confirm something is actually enforcing it",
      why: "An account carries approvals in storage whether or not anything reads them. This checks the code, which is the half that can silently stop being true.",
      href: "/account",
      done: onChain(snapshot.account?.guard.kind === "confirmed"),
    },
    {
      id: "approve-version",
      title: "Approve a version",
      why: "From the CLI, where the bytes being approved are the bytes on your disk. A page cannot honestly make that claim, which is why there is no button for it here.",
      done: onChain(snapshot.approvals.length > 0),
      cliOnly: true,
    },
    {
      id: "publish-pin",
      title: "Publish a skill and bond it",
      why: "Locks collateral against your version claim, and gets you a badge that links to the pin so a reader can check it rather than trust it.",
      done: onChain(hasPublished(snapshot)),
      cliOnly: true,
    },
  ];

  const done = steps.filter((s) => s.done).length;

  return {
    steps,
    done,
    total: steps.length,
    showCount: done > 0,
    complete: done === steps.length,
  };
}

/** Whether the account being viewed has published to this registry. */
function hasPublished(snapshot: Snapshot): boolean {
  const account = snapshot.account?.address.toLowerCase();
  if (account === undefined) return false;
  return snapshot.publishers.some((p) => p.address.toLowerCase() === account);
}

/**
 * The step to point at next: the first unsatisfied one that can actually be acted on here.
 *
 * Skips CLI-only steps, because "next" should be something the reader can do from where they are
 * standing. If the only things left are CLI-only, there is no next action in the browser and the
 * caller says so rather than linking somewhere that cannot help.
 */
export function nextStep(state: Quickstart): QuickstartStep | undefined {
  return state.steps.find((step) => !step.done && step.href !== undefined);
}
