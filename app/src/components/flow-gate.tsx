"use client";

/**
 * Moves a reader to the stage they are actually at.
 *
 * ## What this is not
 *
 * Not an auth guard, and it cannot be one. This app is a static export: every route is a file that can be
 * requested directly, and nothing here runs before the response. Someone who types `/dashboard` gets
 * `/dashboard`, and this component then decides whether to move them. That is a redirect, not a
 * permission, and `lib/flow.ts` says so at length because the distinction is the sort of thing that gets
 * quietly upgraded in a README into a security claim.
 *
 * What it buys is ordering for a first-time reader: the argument, then the ask, then the checklist, then
 * the instrument. Nothing more.
 *
 * ## Why it renders nothing and lives in the layout
 *
 * A wrapper that gated `children` would mean every page paid a render for a decision that concerns four
 * of them, and it would flash the wrong content before deciding. This sits beside `VisitTracker`, which is
 * mounted for the same reason: one place, so adding a route does not mean remembering to wire it up.
 *
 * ## The two ways this goes wrong, both guarded
 *
 * A redirect loop. `redirectFor` returns undefined when the reader is already where they belong, and it is
 * tested for exactly that. Without it, `replace` fires on every render forever.
 *
 * A redirect before storage is read. `loaded` is false until `localStorage` has been parsed, and during
 * that window a returning reader looks exactly like a new one -- no profile, nothing acknowledged. Acting
 * then would bounce every returning reader to the landing page on every cold load, which is the single
 * worst bug this component could have. So it waits.
 */

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { redirectFor, stageFor } from "@/lib/flow";
import type { Stage } from "@/lib/flow";

import { useIdentity } from "./identity";
import { useSettings } from "./settings";

/**
 * The reader's current stage, for anything that needs to look different mid-flow.
 *
 * Returns `"ready"` until storage has been parsed. That default is deliberate and it is the safe one: the
 * alternative is treating every reader as mid-flow for a frame, which would hide the navigation on every
 * cold load and make the whole app flicker its chrome. Being briefly too permissive costs nothing here,
 * because the gate itself waits for the same flag before it moves anyone.
 */
export function useFlowStage(): Stage {
  const { settings, loaded } = useSettings();
  const { connected } = useIdentity();

  if (!loaded) return "ready";

  return stageFor({
    connected,
    profile: settings.profile,
    onboardingAcknowledged: settings.onboardingAcknowledged,
    skippedSetup: settings.skippedSetup,
  });
}

export function FlowGate() {
  const { settings, loaded } = useSettings();
  const { connected } = useIdentity();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    // See above: acting before storage is parsed treats every returning reader as new.
    if (!loaded) return;

    const stage = stageFor({
      connected,
      profile: settings.profile,
      onboardingAcknowledged: settings.onboardingAcknowledged,
      skippedSetup: settings.skippedSetup,
    });

    const target = redirectFor(stage, pathname);
    if (target === undefined) return;

    /*
     * `replace`, not `push`.
     *
     * A pushed redirect puts the page the reader was steered away from into their history, so the back
     * button returns them to it and the gate immediately steers them off again. Two taps of back and
     * nothing moves, which reads as a broken app rather than as a flow.
     */
    router.replace(target);
  }, [
    loaded,
    connected,
    settings.profile,
    settings.onboardingAcknowledged,
    settings.skippedSetup,
    pathname,
    router,
  ]);

  return null;
}
