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
