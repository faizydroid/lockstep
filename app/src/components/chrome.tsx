"use client";

/**
 * The shell around every page, minus the parts a reader mid-flow should not be given.
 *
 * ## The bug this fixes
 *
 * The navigation rail rendered on every route including the landing page, and the flow gate bounces a
 * mid-flow reader off product pages. Together those made the rail a trap: a first-time visitor on `/`
 * could see Pins, Drift, Bonds and Badge, click any of them, and be returned to the page they started on
 * with no explanation. That is exactly the trap that was removed from the hero's buttons when the flow was
 * added, still sitting in the primary navigation, and it was worse there -- a rail is the one thing a
 * reader trusts to be navigable.
 *
 * Two ways to fix it. Stop bouncing, which means the flow no longer holds and is not a flow. Or stop
 * offering links a reader cannot follow yet, which is this.
 *
 * ## Why this is also just better
 *
 * A landing page with the product's full application rail bolted to its left side was never right. The
 * rail is for someone working inside the instrument; a first-time reader is being shown an argument. So
 * while a reader is at the landing, profile or onboarding stage they get a minimal bar with the mark and
 * the theme toggle, and the rail appears when they arrive at the product.
 *
 * ## What stays in both cases, and why
 *
 * The source banner. It is the disclosure that the figures are worked examples rather than readings, and
 * the landing page shows two fingerprints and a refusal drawn from those fixtures. Hiding the caveat on the
 * most-read page in the app to tidy up its chrome would be indefensible.
 *
 * The footer. It carries the note that approving happens in the CLI and never in a browser, which is a
 * claim about the threat model rather than a piece of navigation.
 */

import Link from "next/link";

import { useFlowStage } from "./flow-gate";
import { Mark, Nav } from "./nav";
import { RouteShell } from "./route-shell";
import { SourceBanner } from "./source-banner";
import { ThemeToggle } from "./theme-toggle";

export function Chrome({ children }: { children: React.ReactNode }) {
  const stage = useFlowStage();
  const inProduct = stage === "ready";

  return (
    <>
      {inProduct ? <Nav /> : <FlowBar />}

      {/*
        The rail is `fixed`, so the offset only applies when the rail is there. Applying it
        unconditionally would indent the landing page by 272px against nothing.
      */}
      <div className={inProduct ? "lg:pl-[var(--rail)]" : undefined}>
        <SourceBanner />

        <main id="main" className="gutter relative z-10 w-full pb-24 pt-5">
          <RouteShell>{children}</RouteShell>
        </main>

        <footer className="gutter relative z-10 w-full pb-12">
          <div className="chunk rounded-xl bg-raise px-6 py-5 text-xs leading-relaxed font-semibold text-faint">
            Approving a skill version happens in the CLI, never here. An approval is a claim about exact
            bytes, and only the machine holding those bytes can make it honestly &mdash; a web page asking
            you to sign a hash it fetched is the shape of the attack this project exists to stop.
          </div>
        </footer>
      </div>
    </>
  );
}

/**
 * The bar shown while a reader is still in the flow.
 *
 * Deliberately almost empty. The only link is the mark, and it goes to the landing page, which is the one
 * destination that is always allowed at every stage -- so this bar cannot produce the bounce it exists to
 * prevent. The theme toggle comes along because a reader who needs dark mode needs it here too.
 */
function FlowBar() {
  return (
    <header className="gutter sticky top-0 z-40 border-b-2 border-line bg-bg/85 py-3 backdrop-blur-xl backdrop-saturate-150">
      <div className="flex items-center gap-3">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-lg py-1">
          <Mark />
          <span className="font-display text-xl font-extrabold tracking-tight text-text">Lockstep</span>
        </Link>

        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
