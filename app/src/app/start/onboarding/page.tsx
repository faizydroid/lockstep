"use client";

/**
 * Step two of two: what is already true, and what is left.
 *
 * ## Why this stage shows a list instead of a tour
 *
 * An overlay tour interrupts exactly when a reader is orienting, is clicked through unread to get at the
 * product, and is gone for good once dismissed. A list can be read now, left half-finished, and picked up
 * from the dashboard later, which is where the same component lives.
 *
 * ## The thing this page must not do
 *
 * It must not tick anything off for being here. The steps come from `lib/quickstart.ts`, where every one is
 * a condition on observable state -- a live registry read, a confirmed guard, an approval that exists on
 * chain -- and the module's own comment explains why the car-wash trick of pre-filling two stamps was
 * refused: a product whose whole argument is the gap between a claim and a reading does not get to open
 * with credit for work nobody did.
 *
 * So this page is allowed to record one thing only, and it is honest: that the reader has seen the list.
 * `onboardingAcknowledged` is about the reader's attention, not about the state of their account, and it is
 * deliberately a separate field from `quickstartDismissed` so neither can be mistaken for the other.
 *
 * The consequence is that a reader can finish this stage with one of five steps satisfied, and that is the
 * correct outcome. The other four require a terminal and a bond.
 */

import { useRouter } from "next/navigation";

import { useSnapshot } from "@/components/data";
import { GuardSays } from "@/components/guard";
import { Reveal } from "@/components/motion";
import { Quickstart } from "@/components/quickstart";
import { useSettings } from "@/components/settings";
import { StageHeader } from "@/components/start";
import { Button, Card } from "@/components/ui";
import { quickstart } from "@/lib/quickstart";
import type { ProfileRole } from "@/lib/settings";
import { displayName } from "@/lib/untrusted";

/**
 * Where each role is pointed first.
 *
 * This is the whole justification for having asked the question on the previous page. If the answer
 * changed nothing, the question was decoration.
 */
const ROLE_NEXT: Record<ProfileRole, { where: string; href: "/account" | "/bonds" | "/publishers" | "/pins"; why: string }> = {
  owner: {
    where: "Check enforcement",
    href: "/account",
    why: "An account holds approvals whether or not anything reads them. That page checks the half that can silently stop being true.",
  },
  publisher: {
    where: "See what a pin costs",
    href: "/bonds",
    why: "A bond is priced by how much a skill may do rather than by what it is worth, so the number depends on what you declare.",
  },
  reviewer: {
    where: "Look at the publishers",
    href: "/publishers",
    why: "Including any who have contradicted themselves, which is the one judgement here the chain can make on its own.",
  },
  looking: {
    where: "Browse the pins",
    href: "/pins",
    why: "Each one binds a publisher's exact bytes to a declared set of powers. It is the unit everything else refers to.",
  },
};

export default function OnboardingPage() {
  const { snapshot } = useSnapshot();
  const { settings, update } = useSettings();
  const router = useRouter();

  const state = quickstart(snapshot, settings.completedSteps);
  const role = settings.profile?.role ?? "looking";
  const pointer = ROLE_NEXT[role];

  /*
   * No name means no comma, rather than a filler word.
   *
   * "Here is where you stand, there" is what a placeholder produces, and it is also exactly what the
   * static HTML contains, since storage has not been read at prerender. Dropping the address entirely
   * reads as a sentence in both cases.
   */
  const name =
    settings.profile === undefined ? undefined : displayName(settings.profile.displayName, "");

  const finish = () => {
    update({ onboardingAcknowledged: true });
    router.push("/dashboard");
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-4">
      <Reveal>
        <StageHeader
          step={2}
          title={
            name === undefined || name === "" ? "Here is where you stand" : `Here is where you stand, ${name}`
          }
        >
          Nothing below is ticked for turning up. Every line is a condition on real state, so the count is
          low on purpose and it can go down again if something stops being true.
        </StageHeader>
      </Reveal>

      {/*
        The mascot states the count in words.

        Worth doing because the number on its own invites the wrong reading -- one of five looks like
        failure until someone explains that three of the four remaining steps need a terminal.
      */}
      <Reveal delay={0.05}>
        <GuardSays mood={state.done > 1 ? "settled" : "watching"}>
          {state.done === 0
            ? "Nothing is satisfied yet, which is honest rather than broken: this build is not pointed at a registry, so there is no state to read."
            : `${state.done} of ${state.total} already holds. The rest need a terminal, because approving and publishing are claims about bytes on a disk and only the machine holding them can make those honestly.`}
        </GuardSays>
      </Reveal>

      {/* One implementation of the list, shared with the dashboard panel. */}
      <Reveal delay={0.08}>
        <Quickstart embedded />
      </Reveal>

      <Reveal delay={0.12}>
        <Card tone="pinned">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <p className="shout text-label text-faint">
                Because you said {role === "looking" ? "you are just looking" : "that is you"}
              </p>
              <h2 className="font-display text-xl leading-tight font-extrabold text-text">
                {pointer.where}
              </h2>
              <p className="measure text-sm leading-relaxed font-semibold text-muted">
                {pointer.why}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button tone="bonded" onClick={finish}>
                Go to the dashboard
              </Button>
              {/*
                The tailored link also finishes the stage, or a reader who follows it would be steered
                straight back here by the flow gate -- the same trap the landing page's product links
                turned into before they were replaced.
              */}
              <Button
                tone="pinned"
                variant="quiet"
                onClick={() => {
                  update({ onboardingAcknowledged: true });
                  router.push(pointer.href);
                }}
              >
                {pointer.where} instead
              </Button>
            </div>
          </div>
        </Card>
      </Reveal>
    </div>
  );
}
