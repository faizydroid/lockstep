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
const ui = readFileSync(join(APP, "components", "ui.tsx"), "utf8");

/**
 * The stylesheet with its comments removed.
 *
 * Same trap as everywhere else in this suite, and it caught two assertions here on first run. `globals.css`
 * explains at length why `.clinical`, Baloo 2 and Nunito were removed, so any check for their *absence*
 * matched the paragraph describing their removal. Prose that names a rejected thing in order to reject it is
 * exactly what these comments are for, so the assertions read stripped CSS.
 */
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, "");

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

describe("there is one design language", () => {
  it("has retired the .clinical scope", () => {
    /*
     * `.clinical` was the landing page's own ground and typeface, and it made the app two products. The worst
     * of it was invisible from either side: components that render on both, like `StartHere`, set
     * `font-display font-extrabold` on their own headings and lost a specificity fight with `.clinical h2`,
     * so the same component drew Inter Tight 600 on `/` and Baloo 2 800 everywhere else.
     */
    expect(cssCode, ".clinical is back").not.toMatch(/\.clinical\b/);
    expect(ALL, "a page is scoping itself to .clinical").not.toMatch(/"[^"]*\bclinical\b/);
  });

  it("uses one typeface for copy and one for data", () => {
    // Baloo 2 and Nunito are gone. `--font-display` survives as an alias so ~40 call sites did not need
    // editing, and it now means "this is a title" rather than "this is a rounder face".
    expect(cssCode).not.toMatch(/Baloo/);
    expect(cssCode).not.toMatch(/Nunito/);
    expect(cssCode).toMatch(/--font-sans:\s*"Inter Tight/);
    expect(cssCode).toMatch(/--font-display:\s*"Inter Tight/);
    expect(cssCode).toMatch(/--font-mono:\s*"JetBrains Mono/);
  });

  it("gives labels the mono voice and buttons the sans voice", () => {
    /*
     * `.shout` was doing both jobs: it sat on buttons AND on every eyebrow, table head, pill and stat label,
     * so "press this" and "this is a column of data" were set identically. It is the label voice now, and the
     * shared Button must not carry it.
     */
    const shout = /\.shout\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(shout).toMatch(/font-family:\s*var\(--font-mono\)/);
    expect(shout).toMatch(/text-transform:\s*uppercase/);

    const button = /const shape = cx\([\s\S]*?\);/.exec(stripComments(ui))?.[0] ?? "";
    expect(button, "the shared Button is still shouting").not.toMatch(/\bshout\b/);
    expect(button).toMatch(/font-medium/);
  });

  it("sizes buttons by height so two of the same size line up", () => {
    // The audit found ~10 distinct control heights, several a couple of pixels apart, because every bespoke
    // button picked its own `py-*`.
    const sizes = /const BUTTON_SIZE = \{[\s\S]*?\} as const;/.exec(ui)?.[0] ?? "";
    for (const height of ["h-9", "h-10", "h-11"]) {
      expect(sizes, `BUTTON_SIZE is missing ${height}`).toContain(height);
    }
  });
});

describe("the interface does not claim more than it knows", () => {
  const data = readFileSync(join(APP, "components", "data.tsx"), "utf8");

  it("distinguishes reading from having read", () => {
    /*
     * The bug: every page computed `live = source.kind === "chain"`, which is false while the read is in
     * flight because the provider seeds a fixture. So the interface asserted the negative -- the hero printed
     * NO REGISTRY CONFIGURED and the registry block printed WORKED EXAMPLE -- and then silently flipped. For
     * the first second of every visit the front page said our own deployment did not exist.
     */
    expect(data).toMatch(/export function useCertainty/);
    expect(data).toMatch(/if \(status === "loading"\) return "reading"/);
  });

  it("uses it on the three surfaces that were asserting the negative", () => {
    for (const file of [
      join(APP, "app", "page.tsx"),
      join(APP, "components", "landing", "hero.tsx"),
      join(APP, "components", "landing", "registry.tsx"),
      join(APP, "app", "dashboard", "page.tsx"),
    ]) {
      const source = stripComments(readFileSync(file, "utf8"));
      expect(source, `${file.slice(APP.length + 1)} does not use certainty`).toMatch(/[Cc]ertainty/);
    }
  });

  it("never leaves the reader on figures that will not arrive", () => {
    /*
     * `loadSnapshot` catches its own read errors, which made this look safe. Anything unanticipated threw out
     * of the async effect instead: the promise rejected, no state was set, and `status` stayed "loading"
     * forever with the fixture UI on screen and the banner reading "reading chain".
     */
    expect(data).toMatch(/try \{[\s\S]*?loadSnapshot[\s\S]*?\} catch/);
    expect(data).toMatch(/kind: "error"/);
  });
});

describe("the app has the boundaries a static export needs", () => {
  it("has a 404 page, because any path is reachable", () => {
    // A static export serves files; anything that is not one falls through to whatever the host does.
    const notFound = readFileSync(join(APP, "app", "not-found.tsx"), "utf8");
    expect(notFound).toMatch(/export default function NotFound/);
    expect(notFound).toMatch(/href="\/"/);
  });

  it("has an error boundary that says nothing on chain was touched", () => {
    /*
     * Without one, a throw in any client component blanks the tree — and on a chain dashboard a white page is
     * indistinguishable from the app deciding your account is empty. The reassurance is true by construction:
     * every write needs an explicit confirmation and a wallet signature.
     */
    const error = readFileSync(join(APP, "app", "error.tsx"), "utf8");
    expect(error).toMatch(/Nothing on chain was touched/);
    expect(error).toMatch(/reset/);
  });
});

describe("one control per job", () => {
  it("has a single segmented control and no bespoke copies of it", () => {
    /*
     * Four existed at three sizes. The badge state picker and the settings motion picker were byte-identical
     * markup, and the account tabs were the same idea two pixels shorter — three instances of one control that
     * a reader could not tell were the same.
     */
    expect(ui).toMatch(/export function Segmented/);
    const bespoke = [...ALL.matchAll(/shout press rounded-pill px-3\.5 py-2 text-label/g)];
    expect(bespoke, "a bespoke segmented chip is back").toHaveLength(0);
  });

  it("has a single text input", () => {
    expect(ui).toMatch(/export function TextInput/);
  });

  it("routes landing links to product pages through ExploreLink", () => {
    /*
     * The flow gate bounces a reader at the landing stage off product routes, so a bare link there does
     * nothing. The first fix was a `<button onClick>`, which broke middle-click, open-in-new-tab and the
     * status-bar preview, and left the primary call to action with no href in the markup at all.
     */
    const start = readFileSync(join(APP, "components", "start.tsx"), "utf8");
    expect(start).toMatch(/export function ExploreLink/);
    expect(start).toMatch(/event\.metaKey \|\| event\.ctrlKey/);

    for (const file of ["hero.tsx", "shell.tsx", "registry.tsx"]) {
      const source = stripComments(readFileSync(join(APP, "components", "landing", file), "utf8"));
      expect(source, `${file} still uses a bespoke explore button`).not.toMatch(
        /onClick=\{\(\) => explore\(/,
      );
    }
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

  it("renders inside the theme scope rather than at the root", () => {
    /*
     * The bug this prevents was visible rather than theoretical. `Field` is a `fixed inset-0 z-0` layer, so
     * mounting it at the root put it above the background of any non-positioned page wrapper AND left it
     * reading the root theme's tokens. The landing page paints its own near-black ground inside a
     * `.clinical` scope, so the grid drew the light theme's `--line-strong` -- #d8d8d8 -- as light dots
     * over #08090a: a loud speckle across the darkest surface in the product.
     */
    const chrome = readFileSync(join(APP, "components", "chrome.tsx"), "utf8");
    const layout = readFileSync(join(APP, "app", "layout.tsx"), "utf8");

    expect(chrome).toMatch(/<Field \/>/);
    // Stripped: layout.tsx documents why it no longer renders it.
    expect(stripComments(layout), "Field is back at the root").not.toMatch(/<Field \/>/);
  });

  it("draws the texture at hairline weight, not emphasis weight", () => {
    /*
     * Reported as noise on the landing page and it was too strong everywhere else too. The dot is now the
     * same value as a hairline border rather than the emphasis value, at half opacity and a wider pitch.
     * The job was only ever to stop large flat fills banding on cheap panels, which does not require the
     * pattern to be visible as a pattern.
     */
    expect(field).toMatch(/radial-gradient\(var\(--line\) 1px/);
    expect(field, "the dot uses the emphasis line value").not.toMatch(/var\(--line-strong\)/);
  });

  it("keeps the landing page's ground clear", () => {
    // The landing page brings its own background and wants nothing painted over it.
    const chrome = readFileSync(join(APP, "components", "chrome.tsx"), "utf8");
    const early = chrome.indexOf('pathname === "/"');
    const fieldAt = chrome.indexOf("<Field />");
    expect(early, "the landing-page bail-out is gone").toBeGreaterThan(-1);
    expect(fieldAt, "Field is not in the chrome").toBeGreaterThan(-1);
    // Field must sit after the early return, or it renders on the landing page too.
    expect(fieldAt).toBeGreaterThan(early);
  });

  it("no longer tracks the pointer across large cards", () => {
    // Was applied to the two cards holding the most important readings in the app: the fingerprint
    // comparison on the landing page and the enforcement verdict on /account.
    expect(ALL).not.toMatch(/<Spotlight/);
    expect(ALL).not.toMatch(/\bspotlight\b/);
  });
});
