import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SKILL_DIR_PLACEHOLDER, displayName } from "../src/lib/untrusted";

/**
 * A publisher's chosen name is attacker-controlled input in the ordinary case.
 *
 * Publishing is open, and this dashboard prints `skillName` in its largest type directly beside its own
 * labels. React escapes it, so none of this is about scripting. It is about two things that are worse in a
 * product whose entire argument is that a label can lie:
 *
 *   A name that misrepresents its own shape. A right-to-left override reverses how the rest of the string
 *   renders, so the name on screen can differ arbitrarily from the name in the hashed bytes. Zero-width
 *   characters let two publishers' skills render identically -- the exact collision this product exists to
 *   make expensive, executed one layer up in the interface.
 *
 *   A name that leaves the page. It reached a shell command the reader is told to paste, and a markdown
 *   snippet the reader is told to commit.
 */

const SRC = join(import.meta.dirname, "..", "src");

describe("displayName", () => {
  it("returns the fallback for undefined and for empty", () => {
    expect(displayName(undefined)).toBe("unnamed skill");
    expect(displayName("")).toBe("unnamed skill");
    expect(displayName("   ")).toBe("unnamed skill");
    expect(displayName(undefined, "unknown skill")).toBe("unknown skill");
  });

  it("leaves an ordinary name alone", () => {
    expect(displayName("kuru-quote")).toBe("kuru-quote");
    expect(displayName("price oracle v2")).toBe("price oracle v2");
  });

  it("strips right-to-left overrides, which let a name render as something else", () => {
    // U+202E reverses the display order of everything after it.
    const spoofed = "safe\u202Eevil";
    expect(displayName(spoofed)).toBe("safeevil");
    expect(displayName(spoofed)).not.toContain("\u202E");
  });

  it("strips every bidi control, not only the override", () => {
    for (const ch of ["\u200e", "\u200f", "\u061c", "\u202a", "\u202b", "\u202c", "\u202d", "\u2066", "\u2069"]) {
      expect(displayName(`a${ch}b`), `bidi ${ch.codePointAt(0)?.toString(16)}`).toBe("ab");
    }
  });

  it("strips zero-width characters, so two different names cannot render identically", () => {
    const a = displayName("kuru\u200bquote");
    const b = displayName("kuruquote");
    // Before this, these two were distinct strings that painted the same pixels.
    expect(a).toBe(b);
    for (const ch of ["\u200b", "\u200c", "\u200d", "\u2060", "\ufeff"]) {
      expect(displayName(`x${ch}y`)).toBe("xy");
    }
  });

  it("turns whitespace controls into a space and removes the rest", () => {
    /*
     * Newlines and tabs separate words, so they must collapse rather than vanish. The first
     * implementation deleted them, which turned "price\toracle" into "priceoracle" -- a changed name and a
     * fresh collision, since two different stored names then painted identical pixels.
     */
    expect(displayName("line\none\ttwo")).toBe("line one two");
    expect(displayName("price\toracle")).not.toBe("priceoracle");

    // Non-whitespace controls carry no word boundary and are simply dropped.
    expect(displayName("a\u0000\u001fb")).toBe("ab");
  });

  it("caps the length and says so with an ellipsis", () => {
    const long = "a".repeat(300);
    const out = displayName(long);
    // 64 characters plus one ellipsis. A name this long communicates nothing past the cut.
    expect(out).toHaveLength(65);
    expect(out.endsWith("\u2026")).toBe(true);
    expect(out.startsWith("a".repeat(64))).toBe(true);
  });

  it("does not add an ellipsis to a name that fits", () => {
    expect(displayName("a".repeat(64))).toBe("a".repeat(64));
    expect(displayName("a".repeat(64))).not.toContain("\u2026");
  });

  it("leaves non-Latin scripts intact rather than pretending to detect lookalikes", () => {
    /*
     * Deliberate. Deciding that "kuru" and "kurу" are confusable is a policy call with false positives,
     * it belongs on the publishing side, and a half-working version would imply a guarantee that is not
     * there. Stripping the script entirely would also break every legitimate non-English name.
     */
    expect(displayName("\u0441\u0435\u0442\u044c")).toBe("\u0441\u0435\u0442\u044c");
    expect(displayName("\u4fa1\u683c")).toBe("\u4fa1\u683c");
  });
});

describe("no publisher-controlled string reaches a copyable command", () => {
  const drift = readFileSync(join(SRC, "app", "drift", "page.tsx"), "utf8");

  it("uses the placeholder constant for the skill directory", () => {
    // A literal would be indistinguishable from a name that happened to look safe.
    expect(drift).toContain("SKILL_DIR_PLACEHOLDER");
    expect(SKILL_DIR_PLACEHOLDER).toMatch(/^[a-z-]+$/);
  });

  it("never interpolates a skill name into a Verify command", () => {
    /*
     * The regression this guards is the worst thing found in this pass. The command was
     * `npx lockstep hash "./${skill.skillName}"`, built from a publisher's manifest and presented with a
     * copy button. A name containing a quote and a semicolon turns that into arbitrary command execution
     * on the reader's machine, handed over by the security dashboard and carrying its authority.
     */
    for (const [, command] of drift.matchAll(/command=\{`([^`]*)`\}/g)) {
      expect(command, `drift Verify command: ${command}`).not.toMatch(/skillName/);
      expect(command, `drift Verify command: ${command}`).not.toMatch(/\$\{skill\./);
    }
  });

  it("bounds the name before it reaches the badge snippet a reader commits", () => {
    const badge = readFileSync(join(SRC, "app", "badge", "page.tsx"), "utf8");
    expect(badge).toMatch(/skillName: displayName\(/);
  });
});

describe("every render of a publisher-controlled name is bounded", () => {
  /** Every .tsx under src, so a new page cannot render a raw name unnoticed. */
  function sources(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...sources(path));
      else if (entry.name.endsWith(".tsx")) out.push(path);
    }
    return out;
  }

  it("passes skillName and skillVersion through displayName wherever they are rendered", () => {
    for (const file of sources(SRC)) {
      const source = readFileSync(file, "utf8");
      const where = file.slice(SRC.length + 1);

      /*
       * Matches a name inside JSX braces that is not already wrapped. The old shape was
       * `{pin.skillName ?? "unnamed skill"}`, which is what this catches.
       */
      for (const field of ["skillName", "skillVersion"]) {
        const raw = new RegExp(`\\{\\s*[A-Za-z?.]*\\.${field}\\s*(\\?\\?|\\})`, "g");
        const hits = [...source.matchAll(raw)].map((m) => m[0]);
        expect(hits, `${where} renders ${field} without displayName: ${hits.join(", ")}`).toHaveLength(
          0,
        );
      }
    }
  });
});
