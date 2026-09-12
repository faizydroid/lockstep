/**
 * Turns a 32-byte hash into something a person can compare at a glance.
 *
 * This exists because of a design failure worth naming. The whole product is the difference
 * between two hashes -- the bytes the account owner approved, and the bytes that would actually
 * run -- and the obvious way to show that is two lines of monospace text. But
 * `0x9b68b339278f…` and `0x960ea319b251…` are indistinguishable to a reader who is not
 * deliberately comparing character by character. A judge watching a three-minute demo will not do
 * that. So the most important fact in the system was the least visible thing on screen.
 *
 * A fingerprint fixes that. Two identical hashes produce identical images; two different hashes
 * produce obviously different ones; and because the mapping is positional, the cells that changed
 * can be marked exactly. Nothing here is decorative -- every mark on screen is derived from real
 * bytes, so the picture is as trustworthy as the hex it came from.
 *
 * The mapping is deliberately lossless over the whole hash. A 32-byte hash is 64 hex nibbles, the
 * grid is 8x8 = 64 cells, and each nibble's 16 values map onto exactly 4 shapes x 4 sizes. So every
 * bit of the hash reaches the image, and no two distinct hashes can render identically. Mirrored
 * identicon-style layouts look tidier but throw away half the input, which would let two different
 * skill versions share a fingerprint -- unacceptable for the one visual the product rests on.
 */

/** The four glyphs. Distinct in silhouette, so they read apart at 6px as well as at 60px. */
export type CellShape = "square" | "circle" | "diamond" | "ring";

const SHAPES: readonly CellShape[] = ["square", "circle", "diamond", "ring"];

/** Four steps rather than a continuum: discrete sizes read as a pattern, a gradient reads as noise. */
const SCALES: readonly number[] = [0.42, 0.6, 0.78, 1];

export interface FingerprintCell {
  /** Position in the nibble sequence, 0..63. Also the diff key. */
  readonly index: number;
  readonly row: number;
  readonly column: number;
  readonly shape: CellShape;
  /** 0.42..1, as a fraction of the cell. */
  readonly scale: number;
  /** The raw nibble, 0..15. Kept so a caller can derive its own encoding. */
  readonly value: number;
}

export interface Fingerprint {
  /** Normalised lower-case hex without the 0x prefix, padded or truncated to 64 characters. */
  readonly normalised: string;
  readonly size: number;
  readonly cells: readonly FingerprintCell[];
  /**
   * A hue derived from the leading bytes, for accenting one pin's identity.
   *
   * Not used by the diff view, which needs semantic colour -- green for approved, red for what is
   * on disk -- rather than a hue that happens to fall out of the hash.
   */
  readonly hue: number;
  /** False when the input carried no hex at all, so a caller can render a distinct blank. */
  readonly valid: boolean;
}

export const FINGERPRINT_SIZE = 8;
const NIBBLES = FINGERPRINT_SIZE * FINGERPRINT_SIZE;

/**
 * Normalises a hash to exactly 64 hex characters, or reports it unusable.
 *
 * Tolerant of shape, strict about content. This is display code reached from chain reads, sample
 * data and query strings, so throwing would blank a whole page over one bad value -- but silently
 * salvaging whatever hex a string happens to contain is worse. An earlier version stripped
 * non-hex characters and rendered from the remainder, which meant the string "not a hash" produced
 * a confident-looking fingerprint out of its two stray `a`s. A picture that says "these are the
 * approved bytes" has to refuse input that is not bytes.
 *
 * So: the value must be entirely hex once the prefix is gone. Anything else returns invalid, and the
 * caller renders a visibly blank grid rather than a plausible one.
 *
 * Short-but-valid hex repeats rather than zero-padding, so a truncated hash still produces a
 * distinctive image instead of a mostly-empty grid that reads as a rendering fault.
 */
function normalise(hash: string): { hex: string; valid: boolean } {
  const blank = { hex: "0".repeat(NIBBLES), valid: false };

  const stripped = hash.trim().toLowerCase().replace(/^0x/, "");
  if (stripped.length === 0) return blank;
  if (!/^[0-9a-f]+$/.test(stripped)) return blank;

  if (stripped.length >= NIBBLES) return { hex: stripped.slice(0, NIBBLES), valid: true };

  let repeated = stripped;
  while (repeated.length < NIBBLES) repeated += stripped;
  return { hex: repeated.slice(0, NIBBLES), valid: true };
}

export function fingerprintOf(hash: string): Fingerprint {
  const { hex, valid } = normalise(hash);

  const cells: FingerprintCell[] = [];
  for (let index = 0; index < NIBBLES; index += 1) {
    const value = Number.parseInt(hex[index] as string, 16);
    cells.push({
      index,
      row: Math.floor(index / FINGERPRINT_SIZE),
      column: index % FINGERPRINT_SIZE,
      // Low two bits pick the glyph, high two bits pick the size. Splitting the nibble this way
      // means a single-bit change in the hash always alters something visible.
      shape: SHAPES[value & 0b11] as CellShape,
      scale: SCALES[(value >> 2) & 0b11] as number,
      value,
    });
  }

  // Hue from the first three bytes, spread across the wheel. Only for identity accents.
  const hue = Number.parseInt(hex.slice(0, 6), 16) % 360;

  return { normalised: hex, size: FINGERPRINT_SIZE, cells, hue, valid };
}

export interface FingerprintDiff {
  /** Cell indices whose nibble differs. Empty when the hashes are identical. */
  readonly changed: readonly number[];
  /** Fraction of cells that differ, 0..1. */
  readonly ratio: number;
  readonly identical: boolean;
}

/**
 * Compares two fingerprints positionally.
 *
 * Because the mapping is positional, "which cells changed" is exactly "which nibbles changed" -- so
 * the highlight is a true statement about the bytes rather than a visual approximation of one.
 *
 * Worth knowing what the ratio means: two unrelated hashes differ in about 15 of every 16 nibbles,
 * so a real substitution reads as almost the whole grid changing. That is the honest picture. It is
 * not a similarity score, and a small ratio does not mean the versions are nearly the same.
 */
export function fingerprintDiff(a: Fingerprint, b: Fingerprint): FingerprintDiff {
  const changed: number[] = [];

  for (let index = 0; index < a.cells.length; index += 1) {
    if (a.cells[index]?.value !== b.cells[index]?.value) changed.push(index);
  }

  return {
    changed,
    ratio: a.cells.length === 0 ? 0 : changed.length / a.cells.length,
    identical: changed.length === 0,
  };
}
