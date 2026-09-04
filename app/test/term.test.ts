import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { TERMS } from "../src/components/term";

/**
 * Keeps the vocabulary and its definitions from drifting apart.
 *
 * Two failure modes, and both are silent in a browser. A `<Term name="pnis">` typo renders as ordinary
 * text, so the word simply stops being defined and nothing looks broken. A definition nobody references
 * is dead weight that still has to be maintained and reviewed. Neither shows up in a screenshot, so both
 * get an assertion.
 *
 * The accessibility assertions are source-level, and that limit is worth naming: they prove the handlers
 * are wired, not that a screen reader announces the panel, which needs a real browser and a real AT. What
 * they catch is the regression that started this work — a definition reachable only with a mouse.
 */

const SRC = join(import.meta.dirname, "..", "src");
const term = readFileSync(join(SRC, "components", "term.tsx"), "utf8");

/** Every .tsx under src, so a new page cannot introduce an undefined term unnoticed. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(path));
    else if (entry.name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

const FILES = sources(SRC);

/** Every `name="..."` passed to a Term, with the file it came from. */
const USAGES: readonly (readonly [string, string])[] = FILES.flatMap((file) => {
  const source = readFileSync(file, "utf8");
  const found: (readonly [string, string])[] = [];
  for (const match of source.matchAll(/<Term name="([^"]+)"/g)) {
    // The group is typed optional under noUncheckedIndexedAccess even though `+` guarantees it.
    const name = match[1];
    if (name !== undefined) found.push([name, file.slice(SRC.length + 1)] as const);
  }
  return found;
});

describe("the term map", () => {
  it("finds Term usages at all, so the regex below is actually testing something", () => {
    expect(USAGES.length).toBeGreaterThan(0);
  });

  it("defines every term that is used", () => {
    for (const [name, file] of USAGES) {
      // A typo here is invisible in the browser: Term falls back to plain text rather than throwing.
      expect(Object.keys(TERMS), `${file} uses <Term name="${name}">`).toContain(name);
    }
  });

  it("uses every term it defines", () => {
    const used = new Set(USAGES.map(([name]) => name));
    for (const name of Object.keys(TERMS)) {
      expect(used, `TERMS["${name}"] is defined but never used`).toContain(name);
    }
  });

  it("gives every definition a gloss that is a sentence, not a label", () => {
    for (const [name, entry] of Object.entries(TERMS)) {
      expect(entry.gloss.length, `TERMS["${name}"].gloss`).toBeGreaterThan(40);
      expect(entry.gloss.trimEnd().endsWith("."), `TERMS["${name}"].gloss ends in a full stop`).toBe(
        true,
      );
    }
  });

  it("never defines a term using the term itself, which would explain nothing", () => {
    for (const [name, entry] of Object.entries(TERMS)) {
      // "A pin is a pin that..." is the classic circular gloss. Multi-word keys are exempt from the
      // word-boundary check only where the head noun legitimately reappears, so this checks the key.
      const circular = new RegExp(`^\\s*(a|an|the)?\\s*${name}\\b`, "i");
      expect(entry.gloss, `TERMS["${name}"].gloss opens by restating the term`).not.toMatch(circular);
    }
  });
});

describe("a definition is reachable by every input a reader might have", () => {
  it("opens on click, which is the only path a touch screen has", () => {
    expect(term).toMatch(/onClick=\{\(\) => setOpen/);
  });

  it("gates hover on a mouse pointer, so a tap does not open and instantly close", () => {
    /*
     * The bug this prevents: on touch, `pointerenter` fires as part of the tap and no `pointerleave`
     * follows. Ungated, the panel opens on enter and the click toggle then closes it, so the tap looks
     * like it did nothing at all.
     */
    expect(term).toMatch(/onPointerEnter/);
    expect(term).toMatch(/pointerType === "mouse"/);
  });

  it("opens on focus, so a keyboard reaches it", () => {
    expect(term).toMatch(/onFocus=\{\(\) => setOpen\(true\)\}/);
    expect(term).toMatch(/onBlur=/);
  });

  it("is a button, so it is in the tab order without a manual tabIndex", () => {
    expect(term).toMatch(/<button\s+type="button"/);
  });

  it("closes on Escape", () => {
    expect(term).toMatch(/event\.key === "Escape"/);
  });

  it("announces itself, rather than relying on a title attribute", () => {
    // The whole reason this component exists: `title` on a span is never announced and never appears
    // on touch. If these three go, the component has regressed into what it replaced.
    expect(term).toMatch(/role="tooltip"/);
    expect(term).toMatch(/aria-describedby=/);
    expect(term).not.toMatch(/<button[^>]*\stitle=/);
  });

  it("caps its width against the viewport, not only in rem", () => {
    // A 16rem panel hung off a word near the right edge of a phone runs off screen, and the half a
    // touch reader cannot see is the half they asked for.
    expect(term).toMatch(/calc\(100vw/);
  });

  it("marks the trigger with a dotted underline rather than a colour alone", () => {
    // Colour alone would not survive a monochrome render and reads as emphasis rather than as
    // something to interact with.
    expect(term).toMatch(/decoration-dotted/);
  });
});
