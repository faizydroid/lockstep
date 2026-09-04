"use client";

/**
 * The quickstart panel, and the route-visit tracking that feeds it.
 *
 * Lives on the overview rather than getting a route of its own, and appears above the scoreboard
 * because a first-time reader's question is "what is this and what do I do" while a returning one's is
 * "is anything wrong". Once every step is satisfied it offers to leave, and once dismissed it stays
 * gone — a checklist that keeps reappearing after it is finished is a nag.
 *
 * A checklist rather than a tour, deliberately. Overlay tours are dismissed and then unavailable, and
 * they interrupt at exactly the moment a reader is orienting. A list persists, can be picked up
 * mid-way, and does not have to be finished in one sitting.
 *
 * `lib/quickstart.ts` holds the whole rule about what counts as done. Nothing in here decides that.
 */

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Address } from "viem";

import { useSnapshot } from "./data";
import { useIdentity } from "./identity";
import { Reveal, SPRING_SOFT, motion, useReducedMotion } from "./motion";
import { useSettings } from "./settings";
import { Button, Card, Pill, cx } from "./ui";
import { VISIT_STEPS, nextStep, quickstart } from "@/lib/quickstart";
import { isAllowedAddress } from "@/lib/settings";

/**
 * Records that a tracked route was visited.
 *
 * Mounted once in the layout rather than per page, so a route added to `VISIT_STEPS` starts counting
 * without anyone remembering to wire it up. Renders nothing.
 */
export function VisitTracker() {
  const pathname = usePathname();
  const { completeStep, loaded } = useSettings();

  useEffect(() => {
    // Waiting for `loaded` matters: writing before stored settings arrive would persist a fresh object
    // and wipe whatever was already there.
    if (!loaded) return;
    const id = VISIT_STEPS[pathname as keyof typeof VISIT_STEPS];
    if (id !== undefined) completeStep(id);
  }, [pathname, loaded, completeStep]);

  return null;
}

/**
 * The missing half of the loop.
 *
 * Three of the five steps — enforcement, approving, publishing — can only become true when the dashboard
 * is reading the reader's *own* account. Nothing told them that. So somebody who actually ran the three
 * commands above came back, saw nothing change, and was stuck at two of five with no indication why. The
 * plumbing already existed: `settings.account` is overridable and the source bar already labels it. What
 * was missing was the sentence connecting the terminal to the page.
 *
 * A wallet connect would also satisfy it, and is offered first because it needs no copy-paste. The input
 * exists because the account a publisher uses in CI is usually not one they hold in a browser.
 */
function PointAtYourAccount() {
  const { settings, update, clear } = useSettings();
  const { available, connected, connect, connecting } = useIdentity();
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const submit = () => {
    const candidate = draft.trim();
    if (candidate === "") {
      clear("account");
      setProblem(undefined);
      return;
    }
    if (!isAllowedAddress(candidate)) {
      setProblem("Needs a 20-byte hex address, and not the zero address.");
      return;
    }
    update({ account: candidate as Address });
    setProblem(undefined);
  };

  if (settings.account !== undefined || connected) {
    return (
      <p className="text-xs leading-relaxed font-semibold text-bonded-ink">
        Reading your account now. The three steps above will tick themselves as the chain says so &mdash;
        there is nothing here to mark done by hand.
      </p>
    );
  }

  return (
    <div className="space-y-3 border-t-2 border-line pt-4">
      <p className="measure text-xs leading-relaxed font-semibold text-muted">
        Already run them? This dashboard is reading a demo account, so your pin will not appear. Point it
        at yours and the three steps above resolve from chain state.
      </p>

      <div className="flex flex-wrap items-start gap-2">
        {available && !connected ? (
          <Button onClick={() => void connect()} disabled={connecting} tone="pinned" size="sm">
            {connecting ? "Waiting for wallet\u2026" : "Connect wallet"}
          </Button>
        ) : null}

        <input
          type="text"
          spellCheck={false}
          autoComplete="off"
          value={draft}
          placeholder="or paste the address the CLI printed"
          aria-label="Account address to read"
          aria-invalid={problem !== undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            setProblem(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
          className="hash chunk min-w-0 flex-1 rounded-lg bg-sunken px-3 py-2 text-xs text-text placeholder:text-faint"
        />
        <Button onClick={submit} disabled={draft.trim() === ""} tone="neutral" variant="quiet" size="sm">
          Read it
        </Button>
      </div>

      {problem === undefined ? null : (
        <p role="alert" className="text-xs font-semibold text-revoked-ink">
          {problem}
        </p>
      )}
      <p className="text-xs leading-relaxed text-faint">
        A public read, and it grants nothing. Clearable in Account &rarr; settings.
      </p>
    </div>
  );
}

export function Quickstart() {
  const { snapshot } = useSnapshot();
  const { settings, loaded, update } = useSettings();
  const still = useReducedMotion();

  const state = quickstart(snapshot, settings.completedSteps);
  const next = nextStep(state);

  /*
   * Nothing renders until settings have loaded.
   *
   * Otherwise the panel appears for a frame and then vanishes for everyone who already dismissed it,
   * which is a worse first impression than a slightly later one.
   */
  if (!loaded || settings.quickstartDismissed) return null;

  const pct = Math.round((state.done / state.total) * 100);

  return (
    <Reveal>
      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-line px-6 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <Pill tone={state.complete ? "bonded" : "pinned"}>
              {state.complete ? "all done" : "start here"}
            </Pill>
            <p className="font-display text-lg leading-tight font-extrabold text-text">
              {state.complete
                ? "You have seen the whole mechanism."
                : "Five things, and the first is already true."}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/*
              The count is hidden until something is satisfied. "0 of 5" before any value has landed
              reads as a demand rather than as progress -- which is also why the first step is one that
              is genuinely already true rather than a free stamp.
            */}
            {state.showCount ? (
              <span className="hash text-xs font-bold text-muted">
                {state.done} of {state.total}
              </span>
            ) : null}
            <Button
              onClick={() => update({ quickstartDismissed: true })}
              tone="neutral"
              variant="quiet"
              size="sm"
            >
              {state.complete ? "Done" : "Hide"}
            </Button>
          </div>
        </div>

        {/* Progress as a bar rather than a ring: it is one number and it reads left to right. */}
        {state.showCount ? (
          <div className="h-1.5 w-full bg-raise-strong">
            <motion.div
              className="h-full bg-bonded"
              initial={still ? { width: `${pct}%` } : { width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={still ? { duration: 0 } : SPRING_SOFT}
            />
          </div>
        ) : null}

        <ol className="divide-y-2 divide-line">
          {state.steps.map((step, index) => (
            <li key={step.id}>
              <div
                className={cx(
                  "flex flex-wrap items-start gap-4 px-6 py-4",
                  step.done ? "bg-bonded-tint/40" : undefined,
                )}
              >
                {/*
                  A number when pending, a tick when done. Not a checkbox: these are not things the
                  reader toggles, they are conditions on real state, and a control implies otherwise.
                */}
                <span
                  aria-hidden
                  className={cx(
                    "shout mt-0.5 grid size-6 shrink-0 place-items-center rounded-pill text-[0.6rem]",
                    step.done
                      ? "bg-bonded text-on-face"
                      : "chunk bg-panel text-faint",
                  )}
                >
                  {step.done ? "\u2713" : index + 1}
                </span>

                <div className="min-w-0 flex-1 space-y-1">
                  <p
                    className={cx(
                      "text-sm font-bold",
                      step.done ? "text-bonded-ink" : "text-text",
                    )}
                  >
                    {step.title}
                    {step.cliOnly === true ? (
                      <span className="ml-2 align-middle">
                        <Pill tone="neutral" title="Not possible from a web page, by design.">
                          CLI
                        </Pill>
                      </span>
                    ) : null}
                  </p>
                  <p className="measure text-xs leading-relaxed font-semibold text-muted">
                    {step.why}
                  </p>
                </div>

                {step.done || step.href === undefined ? null : (
                  <Button
                    href={step.href}
                    tone={next?.id === step.id ? "pinned" : "neutral"}
                    variant={next?.id === step.id ? "solid" : "quiet"}
                    size="sm"
                  >
                    {next?.id === step.id ? "Do this next" : "Open"}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>

        {/*
          When the only remaining steps are CLI-only there is no next action in the browser, and saying
          so is better than linking somewhere that cannot help.
        */}
        {next === undefined && !state.complete ? (
          <div className="space-y-4 border-t-2 border-line bg-raise px-6 py-4">
            <p className="measure text-xs leading-relaxed font-semibold text-muted">
              Everything left happens in a terminal, and that is the design rather than a gap. Approving
              and publishing both commit a claim about exact bytes, and only the machine holding those
              bytes can make it honestly.
            </p>
            <pre className="overflow-x-auto rounded-lg bg-sunken p-3 text-xs leading-relaxed text-muted">
              <code className="hash">{"lockstep hash ./skill\nlockstep publish ./skill\nlockstep approve ./skill"}</code>
            </pre>

            <PointAtYourAccount />
          </div>
        ) : null}
      </Card>
    </Reveal>
  );
}
