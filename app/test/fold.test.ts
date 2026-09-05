import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guards the vertical budget of the first screen.
 *
 * The overview once opened with a stacked eyebrow, a 6.5rem headline and a four-line paragraph, which
 * against the type scale came to roughly 610px before any real content -- about seventy percent of a
 * laptop fold, with the scoreboard that answers "is anything wrong" sitting underneath it.
 *
 * The fix at the time was a two-column hero: headline left, explanation right, so the paragraph left the
 * vertical stack entirely. That is no longer the layout. The landing page was rebuilt as a centred,
 * tight, single-column fold, and the hero moved out of `app/page.tsx` into `components/landing/hero.tsx`.
 * So the assertions below follow the hero to its new file, and the two-column check is replaced by the
 * constraint that actually holds the budget now: a capped measure and a bounded headline.
 *
 * These are source assertions, and that limit is worth being plain about: measuring real layout needs a
 * browser and there is none in this suite. What they catch is the specific regression that produced the
 * original problem -- a display-size headline growing back, and prose running the full width of a
 * 1600px viewport.
 */

const APP = join(import.meta.dirname, "..", "src");

/**
 * Source with comments removed.
 *
 * The fifth appearance of one mistake in this suite, so it is worth stating flatly: any assertion about
 * what the code *does* has to read stripped source, because this repo documents the patterns it rejects.
 * The check below for a directly-linked product route failed against a comment reading
 * "`<Link href="/dashboard">` here would bounce them back" -- prose whose entire purpose is to say that
 * exact thing must not be written.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const overview = readFileSync(join(APP, "app", "page.tsx"), "utf8");
const hero = readFileSync(join(APP, "components", "landing", "hero.tsx"), "utf8");
const heroCode = stripComments(hero);
const layout = readFileSync(join(APP, "app", "layout.tsx"), "utf8");
const chrome = readFileSync(join(APP, "components", "chrome.tsx"), "utf8");
const banner = readFileSync(join(APP, "components", "source-banner.tsx"), "utf8");

/** Every `text-[Nrem]` and `text-Nxl` in the hero's h1, as rem. */
function headlineSizes(source: string): number[] {
  const h1 = /<h1[^>]*className="([^"]*)"/.exec(source)?.[1] ?? "";
  const sizes: number[] = [];

  for (const [, rem] of h1.matchAll(/text-\[(\d*\.?\d+)rem\]/g)) sizes.push(Number(rem));

  // Tailwind's named scale, only the ones large enough to matter here.
  const NAMED: Record<string, number> = { "4xl": 2.25, "5xl": 3, "6xl": 3.75, "7xl": 4.5, "8xl": 6, "9xl": 8 };
  for (const [, name] of h1.matchAll(/text-(\d+xl)\b/g)) {
    const rem = name === undefined ? undefined : NAMED[name];
    if (rem !== undefined) sizes.push(rem);
  }
  return sizes;
}

describe("the overview fold", () => {
  it("has a headline, so the selector above is actually finding something", () => {
    expect(headlineSizes(hero).length).toBeGreaterThan(0);
  });

  it("keeps the headline under 5rem at every breakpoint", () => {
    // 6.5rem over two lines at leading 0.94 is ~196px of headline alone. 3.75rem is ~107px.
    for (const size of headlineSizes(hero)) {
      expect(size, `headline size ${size}rem`).toBeLessThanOrEqual(5);
    }
  });

  it("caps the measure of the fold's prose", () => {
    /*
     * Replaces the two-column assertion, which no longer describes the design.
     *
     * The old hero put the explanation beside the headline specifically to get it out of the vertical
     * stack. The rebuilt fold is centred and single-column by request, so the paragraph is back in the
     * stack -- and the thing keeping it from costing the same 200px is that it is short and capped. An
     * uncapped centred paragraph on a 1600px viewport is one long line, which is worse than either.
     */
    expect(hero).toMatch(/max-w-\w+/);
    expect(hero).toMatch(/text-center/);
  });

  it("gives the fold something to do, without linking somewhere the gate will bounce", () => {
    /*
     * Two buttons, and neither is a plain link to a product route.
     *
     * This trap has now appeared three times: the hero's original buttons, the navigation rail, and then
     * the rebuilt hero's primary call to action. The flow gate turns a reader at the landing stage away
     * from product routes, so `<Link href="/dashboard">` here would bounce them back to the page they are
     * standing on. `useExplore` records that following it *is* choosing to look around, then navigates.
     */
    expect(heroCode).toMatch(/useExplore/);
    expect(heroCode).toMatch(/Explore registry/);
    expect(heroCode).toMatch(/Install CLI/);
    expect(heroCode, "a product route is linked directly from the fold").not.toMatch(
      /href="\/(?:dashboard|pins|drift|bonds|approvals|publishers|badge)"/,
    );
  });

  it("does not go back to a 96px section rhythm", () => {
    // space-y-24 across seven sections was ~280px of scroll on top of the hero.
    expect(overview).not.toMatch(/className="space-y-24"/);
  });

  it("keeps the live source bar the smallest band on the page", () => {
    // The live state is a confirmation nobody needs to read; it must not be padded like content.
    expect(banner).toMatch(/rounded-pill bg-raise px-3 py-1 /);
    expect(banner).not.toMatch(/rounded-pill bg-raise px-4 py-2/);
  });

  it("buys that height from padding and not from type size", () => {
    // An earlier pass took the bar to text-[0.7rem], which is 11px, for about one pixel of height.
    // Shrinking text below the 12px the rest of the chrome uses is the wrong currency to pay in.
    expect(banner).toMatch(/rounded-pill bg-raise px-3 py-1 text-xs/);
  });

  it("still shouts when the data is not live", () => {
    // The whole point of the asymmetry. Compressing the honest disclosure would be the wrong fix,
    // so this asserts the sample bar kept its full panel treatment.
    expect(banner).toMatch(/bg-attention-tint px-5 py-3\.5/);
    expect(banner).toMatch(/worked example, not a reading from a deployment/);
  });

  it("does not stack the banner's padding against main's", () => {
    /*
     * Reads chrome.tsx, not layout.tsx. `<main>` moved there when the shell became a client component so
     * the navigation rail could be hidden while a reader is still in the first-run flow. The decision being
     * protected is unchanged: the source banner contributes its own top padding, and at `pt-8` the two
     * stacked to about 48px of nothing above the first real element on every page.
     */
    expect(chrome).toMatch(/id="main"[^>]*pt-5/);
    expect(chrome).not.toMatch(/id="main"[^>]*pt-8/);
  });
});

/**
 * Two design decisions that are invisible in a screenshot diff and easy to refactor away.
 *
 * The selected nav item used to change colour and gain a tinted box while keeping an identical icon,
 * which is what a default iOS tab bar does. A selected icon that is visibly heavier reads as pressed
 * rather than merely highlighted. And empty states were centred text in a box, in an app that already
 * had a four-mood mascot delivering news everywhere else — which left the emptiest screens as the only
 * ones with nothing on them.
 */
describe("design decisions worth pinning", () => {
  const nav = readFileSync(join(APP, "components", "nav.tsx"), "utf8");
  const ui = readFileSync(join(APP, "components", "ui.tsx"), "utf8");

  it("draws the selected nav icon at a heavier stroke", () => {
    expect(nav).toMatch(/strokeWidth=\{heavy \? 3\.2 : 2\.5\}/);
  });

  it("passes the active state into the icon, or the heavier weight never renders", () => {
    // The half that is easy to lose: Glyph can accept `heavy` while the call site never sets it.
    expect(nav).toMatch(/<Icon heavy=\{active\} \/>/);
  });

  it("keeps one icon set at two weights rather than two sets", () => {
    // A filled variant would mean a second set of thirty-odd paths to keep in step, and the failure
    // mode of two icon sets is that they drift and the nav ends up mixing styles.
    expect(nav).not.toMatch(/fill="currentColor"/);
  });

  it("has the mascot deliver empty states", () => {
    expect(ui).toMatch(/<Guard mood=\{mood\}/);
  });

  it("keeps the empty-state mascot decorative", () => {
    // The title and paragraph beside it say everything; a screen reader announcing "Guard is watching"
    // before them is noise. An empty label would leave an image with no accessible name, so the
    // subtree is hidden instead.
    // Sliced to the next top-level export rather than to the next `}`, which a non-greedy match finds
    // at the end of the destructured parameter list instead of the end of the body.
    const at = ui.indexOf("export function Empty(");
    expect(at).toBeGreaterThan(-1);
    const empty = ui.slice(at, ui.indexOf("\nexport ", at + 1));

    expect(empty).toMatch(/<span aria-hidden>/);
    expect(empty).not.toMatch(/label=""/);
  });

  it("defaults the empty-state mood to watching rather than to something sad", () => {
    // Several of these states are correct outcomes -- no refusals recorded is good news -- and drawing
    // that as disappointment would teach a reader that a healthy registry is a broken page.
    expect(ui).toMatch(/mood = "watching"/);
  });
});

/**
 * Copy that carries an argument, and would survive a tidy-up looking like nothing was lost.
 *
 * The limitations panel is the strongest single thing added from the onboarding material: stating a
 * boundary raises credibility with an audience that was going to probe for it anyway. Every limit in it is
 * already in the README, so a refactor that removed the panel would leave the claims intact and the
 * honesty invisible. Same for the wallet priming, which is the only permission-shaped moment in the app.
 */
describe("copy that is load-bearing", () => {
  const limits = readFileSync(join(APP, "components", "limits.tsx"), "utf8");
  const overview = readFileSync(join(APP, "app", "page.tsx"), "utf8");
  const account = readFileSync(join(APP, "components", "account-control.tsx"), "utf8");
  const navSrc = readFileSync(join(APP, "components", "nav.tsx"), "utf8");

  it("names the four limits rather than one soft disclaimer", () => {
    for (const limit of ["stolen key", "hostile from its first publish", "cryptographically", "does not move funds"]) {
      expect(limits, limit).toContain(limit);
    }
  });

  it("names the cryptographic / economic split, which is what makes the list a threat model", () => {
    expect(limits).toMatch(/cryptographic/);
    expect(limits).toMatch(/economic/);
    expect(limits).toMatch(/overclaiming/);
  });

  it("still carries the boundary, collapsed at the bottom rather than mid-page", () => {
    /*
     * The intent of this assertion was reversed on instruction, and that is worth recording rather than
     * quietly rewriting, because the two positions encode opposite judgements.
     *
     * It used to require the boundary panel *before* the ask, on the reasoning that stating a limit first
     * is what makes the ask credible. The design brief for the rebuilt landing page took the other view:
     * four paragraphs of "out of scope" above the conversion flow is unusable to a reader who has not yet
     * been told what the product does, so it belongs at the bottom behind a disclosure.
     *
     * Both are defensible. What is not defensible is the version where "moved to the bottom" quietly
     * becomes "deleted", since every limit in it is already in the README and its absence would leave the
     * claims intact and the honesty invisible. So this now asserts presence and reachability instead of
     * position: the section is on the page, it is after the ask, and the header links to it so a sceptic
     * is one click from it.
     */
    const askAt = overview.indexOf("<StartHere />");
    const boundaryAt = overview.indexOf("<ThreatModel />");

    expect(askAt, "the invitation is not on the landing page").toBeGreaterThan(-1);
    expect(boundaryAt, "the boundary section is not on the landing page").toBeGreaterThan(-1);
    expect(boundaryAt).toBeGreaterThan(askAt);

    // Reachable in one click from the top, or "at the bottom" really does mean buried.
    const shell = readFileSync(join(APP, "components", "landing", "shell.tsx"), "utf8");
    expect(shell).toMatch(/#threat-model/);
  });

  it("uses a real disclosure element for the boundary", () => {
    /*
     * `<details>` rather than a div with state. Keyboard operation and the correct ARIA semantics come
     * free, and on a security page an accordion a keyboard user cannot open is a disclosure that does not
     * exist for them. It also means the content ships in the HTML whether or not it is open, so
     * check-export can still assert the copy.
     */
    const threat = readFileSync(join(APP, "components", "landing", "threat-model.tsx"), "utf8");
    expect(threat).toMatch(/<details/);
    expect(threat).toMatch(/<summary/);
  });

  it("keeps the instrument off the landing page", () => {
    // A returning reader should not pay for the pitch to see the scoreboard, and a first-time reader
    // should not meet a ledger before knowing what it counts.
    for (const marker of ["<Scoreboard", "<Ledger", "<Quickstart"]) {
      expect(overview, `${marker} belongs on /dashboard`).not.toContain(marker);
    }
  });

  it("says who the product does not help", () => {
    expect(limits).toMatch(/Probably not for you if/);
    expect(limits).toMatch(/does not move funds/);
  });

  it("states that connecting requests no signature, before the wallet popup", () => {
    // A crypto developer's default assumption about a connect button is that something will ask them to
    // sign. Only saying so fixes that, and it has to be said before the prompt, not after.
    expect(account).toMatch(/No signature is requested/);
    expect(account).toMatch(/no server to send it to/);
  });

  it("gives every nav item an outcome line", () => {
    // Seven of eight labels are coinages of this project and mean nothing on a first read.
    const items = navSrc.match(/outcome: "/g) ?? [];
    expect(items).toHaveLength(8);
  });
});
