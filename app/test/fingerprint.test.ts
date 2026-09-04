/**
 * The fingerprint carries the product's central claim, so its properties are asserted rather than
 * eyeballed.
 *
 * Three of these matter more than the rest. Identical hashes must render identically, or the
 * "nothing changed" case looks like a change. Different hashes must never render identically, or the
 * one visual the product rests on could show a swapped version as the approved one. And the diff must
 * mark exactly the nibbles that differ, since the highlight is presented to a reader as a statement
 * about bytes.
 */

import { describe, expect, it } from "vitest";

import { APPROVED_HASH, DRIFTED_HASH } from "@/lib/fixtures";
import { FINGERPRINT_SIZE, fingerprintDiff, fingerprintOf } from "@/lib/fingerprint";

const hash = (body: string) => `0x${body.padEnd(64, "0").slice(0, 64)}`;

describe("fingerprintOf", () => {
  it("produces one cell per nibble of a 32-byte hash", () => {
    const print = fingerprintOf(APPROVED_HASH);
    // 32 bytes is 64 nibbles, and the grid is 8x8. Every bit of the hash reaches the image.
    expect(print.cells).toHaveLength(FINGERPRINT_SIZE * FINGERPRINT_SIZE);
    expect(print.cells).toHaveLength(64);
  });

  it("is deterministic", () => {
    expect(fingerprintOf(APPROVED_HASH)).toEqual(fingerprintOf(APPROVED_HASH));
  });

  it("ignores case and the 0x prefix", () => {
    const lower = fingerprintOf(APPROVED_HASH);
    const upper = fingerprintOf(APPROVED_HASH.toUpperCase().replace("0X", "0x"));
    const bare = fingerprintOf(APPROVED_HASH.slice(2));

    expect(upper.cells).toEqual(lower.cells);
    expect(bare.cells).toEqual(lower.cells);
  });

  it("lays cells out in row-major order", () => {
    const print = fingerprintOf(APPROVED_HASH);
    for (const cell of print.cells) {
      expect(cell.row).toBe(Math.floor(cell.index / FINGERPRINT_SIZE));
      expect(cell.column).toBe(cell.index % FINGERPRINT_SIZE);
    }
  });

  it("maps each nibble to exactly one shape and size pair", () => {
    // 16 nibble values across 4 shapes and 4 scales, with no collisions: the encoding is a
    // bijection, which is what makes the image lossless over the hash.
    const seen = new Set<string>();
    for (let value = 0; value < 16; value += 1) {
      const cell = fingerprintOf(value.toString(16).repeat(64)).cells[0];
      expect(cell).toBeDefined();
      seen.add(`${cell!.shape}:${cell!.scale}`);
    }
    expect(seen.size).toBe(16);
  });

  /**
   * The property that makes the visual trustworthy.
   *
   * If two different hashes could render identically, the drift view could show a swapped version as
   * though it were the approved one -- the exact failure the product exists to prevent.
   */
  it("never renders two different hashes the same way", () => {
    const a = fingerprintOf(APPROVED_HASH);
    const b = fingerprintOf(DRIFTED_HASH);
    expect(a.cells).not.toEqual(b.cells);
  });

  it("reflects a single-nibble change", () => {
    const base = hash("233f0359c38d87e332c87aa294aab227d89d2a12ece44b254e65ddb4011681e0");
    const tweaked = hash("233f0359c38d87e332c87aa294aab227d89d2a12ece44b254e65ddb4011681e1");

    const diff = fingerprintDiff(fingerprintOf(base), fingerprintOf(tweaked));
    expect(diff.changed).toEqual([63]);
    expect(diff.identical).toBe(false);
  });

  it("reflects a change in the very first nibble", () => {
    const diff = fingerprintDiff(fingerprintOf(hash("a")), fingerprintOf(hash("b")));
    expect(diff.changed).toContain(0);
  });

  describe("malformed input", () => {
    /**
     * Tolerant rather than throwing.
     *
     * This renders inside pages fed by chain reads, sample data and query strings. A throw here
     * would blank a whole page over one bad value, so an unusable input becomes a distinct blank
     * that a caller can label instead.
     */
    it("marks a non-hex input as invalid instead of throwing", () => {
      const print = fingerprintOf("not a hash");
      expect(print.valid).toBe(false);
      expect(print.cells).toHaveLength(64);
      expect(print.cells.every((c) => c.value === 0)).toBe(true);
    });

    /**
     * The case that caught a real flaw.
     *
     * "not a hash" contains two stray `a` characters. An earlier version stripped everything that
     * was not hex and rendered from the remainder, so a plainly bogus string produced a
     * confident-looking fingerprint. A picture captioned "the approved bytes" must refuse input
     * that is not bytes, so content is now validated rather than salvaged.
     */
    it("refuses a mostly-non-hex string rather than salvaging its hex characters", () => {
      for (const input of ["not a hash", "deadbeef!", "0xdead beef", "cafe\u00a0babe", "—"]) {
        expect(fingerprintOf(input).valid, input).toBe(false);
      }
    });

    it("still accepts genuine hex in any casing or prefixing", () => {
      for (const input of ["0xDEADBEEF", "deadbeef", "  0xdeadbeef  "]) {
        expect(fingerprintOf(input).valid, input).toBe(true);
      }
    });

    it("repeats a short hash rather than padding it with blanks", () => {
      // Zero-padding would render as a mostly-empty grid, which looks like a rendering bug rather
      // than a short value.
      const print = fingerprintOf("0xabc");
      expect(print.valid).toBe(true);
      expect(print.normalised).toHaveLength(64);
      expect(print.cells.some((c) => c.value !== 0)).toBe(true);
    });

    it("truncates an over-long input to 32 bytes", () => {
      const print = fingerprintOf(`0x${"f".repeat(200)}`);
      expect(print.normalised).toHaveLength(64);
    });

    it("survives an empty string", () => {
      expect(fingerprintOf("").valid).toBe(false);
      expect(fingerprintOf("0x").valid).toBe(false);
    });
  });
});

describe("fingerprintDiff", () => {
  it("reports nothing changed for identical hashes", () => {
    const diff = fingerprintDiff(fingerprintOf(APPROVED_HASH), fingerprintOf(APPROVED_HASH));
    expect(diff.identical).toBe(true);
    expect(diff.changed).toEqual([]);
    expect(diff.ratio).toBe(0);
  });

  /**
   * The real case, with the hashes from the live end-to-end run.
   *
   * Two unrelated hashes differ in roughly 15 of every 16 nibbles, so a genuine substitution should
   * light up nearly the whole grid. That is the honest picture of what happened, and it is why the
   * ratio must not be read as a similarity score.
   */
  it("lights up most of the grid for the real drift case", () => {
    const diff = fingerprintDiff(fingerprintOf(APPROVED_HASH), fingerprintOf(DRIFTED_HASH));
    expect(diff.identical).toBe(false);
    expect(diff.ratio).toBeGreaterThan(0.8);
  });

  it("is symmetric", () => {
    const a = fingerprintOf(APPROVED_HASH);
    const b = fingerprintOf(DRIFTED_HASH);
    expect(fingerprintDiff(a, b).changed).toEqual(fingerprintDiff(b, a).changed);
  });

  it("returns changed indices in ascending order", () => {
    const diff = fingerprintDiff(fingerprintOf(APPROVED_HASH), fingerprintOf(DRIFTED_HASH));
    const sorted = [...diff.changed].sort((x, y) => x - y);
    expect(diff.changed).toEqual(sorted);
  });
});
