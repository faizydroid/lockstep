"use client";

/**
 * The landing page's own header and footer.
 *
 * ## Why the page does not use the app's chrome
 *
 * `components/chrome.tsx` gives every route either the navigation rail or a compact bar, plus the source
 * banner. On this page both are wrong. The rail belongs to someone working inside the instrument, and the
 * source banner is a disclosure panel sitting directly above the fold -- which is the one thing the brief
 * rules out, and it is right to: a reader who has not yet been told what the product does cannot use a
 * caveat about where its numbers came from.
 *
 * The disclosure is not dropped. It moves into the live registry block, against the figures it actually
 * qualifies, which is a stronger position than the top of the page. A caveat beside the number it applies
 * to is read; a caveat thirty centimetres above it is furniture.
 */

import Link from "next/link";

import { Mark } from "../nav";
import { ExploreLink } from "../start";
import { ThemeToggle } from "../theme-toggle";

/**
 * Where the header points. Three items, which is as many as a landing page can carry usefully.
 *
 * `product: true` marks a destination behind the first-run flow. Those cannot be plain links: the gate
 * turns a reader at the landing stage away from product routes, so an anchor would bounce them back here.
 * They go through `useExplore`, which records that the reader chose to look around and then navigates.
 */
const NAV: readonly { label: string; href: string; external?: boolean; product?: boolean }[] = [
  { label: "Threat model", href: "#threat-model" },
  { label: "Registry", href: "/dashboard", product: true },
  /*
   * GitHub last, and worth flagging: this repository is private, so the link 404s for anyone who is not
   * the owner. Kept because it is the correct destination the moment the repo is public, and a landing
   * page for developer infrastructure without a source link is its own kind of suspicious.
   */
  { label: "GitHub", href: "https://github.com/faizydroid/lockstep", external: true },
];

export function LandingHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <Mark />
          <span className="text-sm font-semibold tracking-tight text-text">Lockstep</span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          {/*
            The theme toggle belongs here now.

            While the landing page was its own `.clinical` scope it forced `color-scheme: dark` and a toggle
            would have had nothing to change, so there was none -- and a reader who set light mode in the app
            and came back to `/` found it ignored with nothing to explain why. One language means one control.
          */}
          <span className="mr-1 hidden sm:block">
            <ThemeToggle />
          </span>

          {NAV.map((item) => {
            const shape =
              "rounded-md px-2.5 py-1.5 text-note text-muted transition-colors hover:bg-raise hover:text-text sm:px-3";

            if (item.external === true) {
              return (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={shape}
                >
                  {item.label}
                </a>
              );
            }

            if (item.product === true) {
              /*
                An anchor with a click handler, not a button.

                All three header items look identical, and one of them being a `<button>` meant it silently
                behaved differently: no middle-click, no open-in-new-tab, no status-bar preview, and no `href`
                in the markup. `ExploreLink` keeps the affordance and adds the flow bookkeeping on top.
              */
              return (
                <ExploreLink key={item.label} href={item.href} className={shape}>
                  {item.label}
                </ExploreLink>
              );
            }

            return (
              <Link key={item.label} href={item.href} className={shape}>
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

export function LandingFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-2">
            <Mark />
            <span className="text-note font-semibold tracking-tight text-text">Lockstep</span>
          </div>

          {/*
            The one claim worth repeating at the bottom, because it is the thing a reader is most likely to
            assume wrongly about a web page in this category: approving a version happens in a terminal,
            never here.
          */}
          <p className="max-w-md text-note leading-relaxed text-faint">
            Approving a skill version happens in the CLI, never in a browser. An approval is a claim about
            exact bytes, and only the machine holding those bytes can make it honestly.
          </p>
        </div>
      </div>
    </footer>
  );
}
