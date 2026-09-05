import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Holds the flat design in place.
 *
 * The app used to be built on Duolingo's tile: a 2px border plus a hard, un-blurred `0 4px 0` underside,
 * with controls travelling down onto their own base when pressed. That is gone by request -- nothing casts
 * a shadow now -- and with it went the only thing separating one surface from another. A hairline border,
 * real spacing and type weight do that work instead, which means the scale has to stay tight or the page
 * goes back to looking scattered.
 *
 * An audit before the change found the concrete problem: fifteen distinct `text-[Nrem]` values across 105
 * uses on top of nine named sizes, fifteen `space-y-*` values, fifteen `gap-*` values, and seven radii.
 * Six of the font sizes sat inside three pixels of each other. None of that was designed; it accumulated
 * one reasonable-looking component at a time, which is exactly why it needs a test rather than a rule
 * somebody remembers.
 */

const APP = join(import.meta.dirname, "..", "src");
const css = readFileSync(join(APP, "app", "globals.css"), "utf8");

/** Every .tsx under src, so a new component cannot reintroduce any of this unnoticed. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(path));
    else if (entry.name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

const FILES = sources(APP);

/**
 * Source with comments removed.
 *
 * Load-bearing here more than anywhere else in the suite. This repo's prose discusses shadows, radii and
 * font sizes constantly -- including long passages explaining why each was removed -- so any assertion
 * that reads raw source is really asserting something about the documentation. Two tests in this file
 * failed on first run for exactly that reason, and the same mistake has now appeared four times across
 * the suite, so: anything checking what the code *does* reads stripped source.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const STRIPPED = FILES.map((f) => stripComments(readFileSync(f, "utf8")));
const ALL = STRIPPED.join("\n");

/**
 * Every double-quoted string literal, which is where class lists live.
 *
 * Not just `className="..."`, because plenty of classes are assembled in `cx()` calls and in tone maps
 * like `CARD_TONE`. Comments are already gone, so what is left is overwhelmingly class lists plus a small
 * amount of `title`/`label` copy, and none of that copy contains a Tailwind utility.
 */
const CLASSES = STRIPPED.flatMap((source) =>
  [...source.matchAll(/"([^"\n]*)"/g)].map((m) => m[1] ?? ""),
).join(" ");

describe("nothing casts a shadow", () => {
  it("defines the surface as an inset hairline and nothing more", () => {
    expect(css).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--line\)/);
  });

  it("emits no offset shadow from the utility layer", () => {
    const utilities = css.slice(css.indexOf("@layer utilities"));
    for (const match of utilities.matchAll(/box-shadow\s*:\s*([^;]+)/g)) {
      // Optional under noUncheckedIndexedAccess even though `+` guarantees the group.
      const value = match[1] ?? "";
      const offending = value
        .split(",")
        .filter((part) => /\d+(?:\.\d+)?(?:px|rem|em)/.test(part) && !part.includes("inset"));
      expect(offending, `box-shadow: ${value.trim()}`).toHaveLength(0);
    }
  });

  it("uses no Tailwind shadow utility in any class name", () => {
    // `shadow-none` would be harmless but is also now meaningless, so it is excluded too.
    const hits = CLASSES.split(/\s+/).filter((cls) => /^(?:\w+:)*(?:drop-)?shadow(?:-|$)/.test(cls));
    expect(hits, `shadow utilities in use: ${hits.join(", ")}`).toHaveLength(0);
  });

  it("does not travel a control on press, having nothing to travel onto", () => {
    /*
     * The old `.press:active` moved the element down by exactly the height of its underside. Keeping the
     * travel without the underside reads as the layout twitching, so the affordance is brightness.
     */
    const press = /\.press:active\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(press).toMatch(/brightness/);
    expect(press).not.toMatch(/translateY/);
  });

  it("inverts the press affordance on the dark theme", () => {
    // Darkening reads as pressed on a light ground and as broken on a dark one.
    expect(css).toMatch(/\.dark \.press:active\s*\{[^}]*brightness\(1\.\d+\)/);
  });
});

describe("the type scale is a ramp, not a cloud", () => {
  it("has no arbitrary font size left in any component", () => {
    const hits = [...ALL.matchAll(/text-\[[0-9.]+rem\]/g)].map(([m]) => m);
    expect([...new Set(hits)], "arbitrary font sizes").toHaveLength(0);
  });

  it("defines the one label size the six micro sizes collapsed into", () => {
    // 0.5, 0.55, 0.6, 0.65, 0.68 and 0.7rem were all in use and are within 3px of each other.
    expect(css).toMatch(/--text-label:/);
    expect(css).toMatch(/--text-note:/);
  });

  it("keeps the display sizes to three steps", () => {
    const display = ["text-4xl", "text-5xl", "text-6xl", "text-7xl", "text-8xl", "text-9xl"].filter(
      (size) => new RegExp(`\\b${size}\\b`).test(CLASSES),
    );
    expect(display.length, `display sizes in use: ${display.join(", ")}`).toBeLessThanOrEqual(3);
  });
});

describe("spacing and radii stay tight", () => {
  it("uses one section rhythm rather than a responsive escalation", () => {
    // Was `space-y-14 sm:space-y-16 2xl:space-y-20`, which made the gap between sections a function of
    // viewport width for no reason a reader could perceive.
    for (const wrong of ["space-y-14", "space-y-16", "space-y-20", "space-y-24"]) {
      expect(CLASSES, `${wrong} is outside the scale`).not.toMatch(new RegExp(`\\b${wrong}\\b`));
    }
  });

  it("keeps space-y to a handful of steps", () => {
    const steps = [...new Set([...CLASSES.matchAll(/\bspace-y-([0-9.]+)\b/g)].map(([, n]) => n))];
    expect(steps.length, `space-y steps: ${steps.sort().join(", ")}`).toBeLessThanOrEqual(8);
  });

  it("keeps gap to a handful of steps", () => {
    const steps = [...new Set([...CLASSES.matchAll(/\bgap-([0-9.]+)\b/g)].map(([, n]) => n))];
    expect(steps.length, `gap steps: ${steps.sort().join(", ")}`).toBeLessThanOrEqual(8);
  });

  it("collapses the radius scale onto four values", () => {
    const radii = [...css.matchAll(/--radius-(?!pill)[a-z0-9]+:\s*([^;]+);/g)].map((m) =>
      (m[1] ?? "").trim(),
    );
    expect(radii.length, "radius names").toBeGreaterThan(4);
    expect(new Set(radii).size, `distinct radii: ${[...new Set(radii)].join(", ")}`).toBeLessThanOrEqual(4);
  });

  it("uses hairline borders throughout, not the old 2px rule", () => {
    for (const wrong of ["border-2", "border-t-2", "border-b-2", "border-l-2", "border-r-2", "divide-y-2"]) {
      expect(CLASSES, `${wrong} is from the old tile design`).not.toMatch(new RegExp(`\\b${wrong}\\b`));
    }
  });
});

describe("the background does not compete with the content", () => {
  const field = readFileSync(join(APP, "components", "field.tsx"), "utf8");

  it("carries no coloured wash", () => {
    /*
     * The principled one. This interface makes colour mean a specific thing -- green bonded, blue pinned,
     * amber attention, red refused -- and every pill and ring depends on that being reliable. Three
     * radial pools of those same hues across the full height of every page made a green pill stop being
     * information.
     */
    for (const wash of ["--wash-a", "--wash-b", "--wash-c"]) {
      expect(field, `${wash} is back in the background`).not.toContain(wash);
    }
  });

  it("does not animate", () => {
    // A lattice drifting under a table of hashes a reader is comparing character by character is movement
    // with no message.
    expect(field).not.toMatch(/motion\.|animate=/);
  });

  it("no longer tracks the pointer across large cards", () => {
    // Was applied to the two cards holding the most important readings in the app: the fingerprint
    // comparison on the landing page and the enforcement verdict on /account.
    expect(ALL).not.toMatch(/<Spotlight/);
    expect(ALL).not.toMatch(/\bspotlight\b/);
  });
});
