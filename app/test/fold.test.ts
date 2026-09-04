import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guards the vertical budget of the first screen.
 *
 * The overview opened with a stacked eyebrow, a 6.5rem headline and a four-line paragraph, which
 * against the type scale came to roughly 610px before any real content -- about seventy percent of a
 * laptop fold. The scoreboard that answers "is anything wrong with my account" sat underneath it.
 *
 * These assertions are on the source rather than on rendered pixels, and that limit is worth being
 * plain about: measuring real layout needs a browser, and there is none in this suite. What they can
 * do is catch the specific regressions that produced the problem -- a display-size headline growing
 * back, the hero collapsing to a single column so the paragraph re-enters the vertical stack, and
 * the page rhythm returning to `space-y-24`. Each of those was a deliberate decision, so each gets
 * an assertion rather than a comment.
 */

const APP = join(import.meta.dirname, "..", "src");

const overview = readFileSync(join(APP, "app", "page.tsx"), "utf8");
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
    expect(headlineSizes(overview).length).toBeGreaterThan(0);
  });

  it("keeps the headline under 5rem at every breakpoint", () => {
    // 6.5rem over two lines at leading 0.94 is ~196px of headline alone. 4.5rem is ~128px.
    for (const size of headlineSizes(overview)) {
      expect(size, `headline size ${size}rem`).toBeLessThanOrEqual(5);
    }
  });

  it("lays the hero out in two columns from lg, so the dek is beside the headline not under it", () => {
    // This is the change that actually bought the space. Losing it would undo the fix even if the
    // headline stayed small, because the paragraph would return to the vertical stack.
    const hero = /function Hero\(\)[\s\S]*?\n}/.exec(overview)?.[0] ?? "";
    expect(hero).toMatch(/lg:grid-cols-\[/);
  });

  it("gives the fold something to do", () => {
    /*
     * Was `<Button href=`. The hero's two buttons used to link straight to /drift and /pins, and the
     * first-run flow turned that into a trap: a first-time reader would click one and be steered back
     * here by the gate, having apparently broken something. The call to action is a flow action now.
     */
    const hero = /function Hero\(\)[\s\S]*?\n}/.exec(overview)?.[0] ?? "";
    expect(hero, "the hero had no call to action at all").toMatch(/<StartHere\b/);
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

  it("puts the boundary after the demonstration and before the ask", () => {
    /*
     * This used to assert the boundary came before `<Ledger`, which lived on the same page. The ledger
     * moved to /dashboard with the route split, so the original assertion could only ever pass by
     * accident. The decision it was protecting is still here and is now sharper, because the order on
     * the landing page is the argument:
     *
     *   the gate demonstrates the mechanism, the boundary says what it does not catch, and only then is
     *   the reader asked for anything.
     *
     * Stating a limit before the ask is what makes the ask credible. Putting it after would make it
     * small print on a page the reader has already committed to.
     */
    const gateAt = overview.indexOf("<SettlementGate />");
    const limitsAt = overview.indexOf("<Limits />");
    const askAt = overview.indexOf("<StartHere />");

    expect(gateAt, "the gate is not on the landing page").toBeGreaterThan(-1);
    expect(limitsAt, "the boundary is not on the landing page").toBeGreaterThan(-1);
    expect(askAt, "the closing invitation is not on the landing page").toBeGreaterThan(-1);

    expect(gateAt).toBeLessThan(limitsAt);
    expect(limitsAt).toBeLessThan(askAt);
  });

  it("keeps the instrument off the landing page", () => {
    // The split's whole point. A returning reader should not pay for the pitch to see the scoreboard,
    // and a first-time reader should not meet a ledger before knowing what it counts.
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
