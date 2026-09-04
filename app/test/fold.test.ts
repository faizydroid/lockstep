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
    const hero = /function Hero\(\)[\s\S]*?\n}/.exec(overview)?.[0] ?? "";
    expect(hero, "the hero had no call to action at all").toMatch(/<Button\s+href=/);
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
    expect(layout).toMatch(/id="main"[^>]*pt-5/);
    expect(layout).not.toMatch(/id="main"[^>]*pt-8/);
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
