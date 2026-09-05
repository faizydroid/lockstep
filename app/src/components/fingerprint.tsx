"use client";

/**
 * Renders a hash as a comparable image.
 *
 * The point is the pair, not the single. On its own a fingerprint is a pleasant mark; side by side
 * with another one it makes "these bytes are not those bytes" a thing you see rather than a thing
 * you read. That is the product's central claim, and it was previously the least visible element on
 * the page.
 *
 * Drawn as SVG rather than canvas: it scales to any size without blurring, inherits `currentColor`
 * so it follows the theme for free, and stays inspectable in devtools. At 64 glyphs there is no
 * performance reason to reach for canvas.
 */

import { useMemo } from "react";

import { FINGERPRINT_SIZE, fingerprintDiff, fingerprintOf } from "@/lib/fingerprint";
import type { CellShape, Fingerprint } from "@/lib/fingerprint";

import { motion, useReducedMotion } from "./motion";
import { cx } from "./ui";

/** Viewbox units per cell. Arbitrary, but keeps the maths in whole numbers. */
const UNIT = 10;
const GAP = 2.2;
const EXTENT = FINGERPRINT_SIZE * UNIT;

type Tone = "bonded" | "revoked" | "pinned" | "muted" | "identity";

const TONE_COLOUR: Record<Tone, string> = {
  bonded: "var(--bonded)",
  revoked: "var(--revoked)",
  pinned: "var(--pinned)",
  muted: "var(--faint)",
  // Overridden per instance from the hash's own hue.
  identity: "currentColor",
};

/**
 * One glyph.
 *
 * Four silhouettes that stay distinguishable when the whole grid is 48px wide, which is the size it
 * appears at in a table row. Rings in particular carry a lot of the visual texture, because a hollow
 * shape reads differently from a solid one even at two pixels.
 */
function Glyph({ shape, x, y, span }: { shape: CellShape; x: number; y: number; span: number }) {
  const half = span / 2;
  const cx0 = x + half;
  const cy0 = y + half;

  if (shape === "circle") return <circle cx={cx0} cy={cy0} r={half} />;

  if (shape === "ring") {
    return (
      <circle
        cx={cx0}
        cy={cy0}
        r={Math.max(half - span * 0.16, span * 0.18)}
        fill="none"
        stroke="currentColor"
        strokeWidth={Math.max(span * 0.22, 0.5)}
      />
    );
  }

  if (shape === "diamond") {
    return (
      <rect
        x={x + span * 0.1}
        y={y + span * 0.1}
        width={span * 0.8}
        height={span * 0.8}
        rx={span * 0.16}
        transform={`rotate(45 ${cx0} ${cy0})`}
      />
    );
  }

  // Rounded square. Generously rounded, to match the rest of the interface.
  return <rect x={x} y={y} width={span} height={span} rx={span * 0.3} />;
}

export interface FingerprintProps {
  hash: string;
  tone?: Tone;
  /** Cell indices to mark as changed. Supplied by the diff view. */
  changed?: readonly number[];
  /** Rendered size in pixels. */
  px?: number;
  className?: string;
  /** Staggers the glyphs in as the grid appears. Off for small inline marks. */
  animate?: boolean;
  label?: string;
}

export function HashFingerprint({
  hash,
  tone = "identity",
  changed,
  px = 96,
  className,
  animate = false,
  label,
}: FingerprintProps) {
  const still = useReducedMotion();
  const print = useMemo(() => fingerprintOf(hash), [hash]);
  const changedSet = useMemo(() => new Set(changed ?? []), [changed]);

  const colour = tone === "identity" ? `oklch(0.72 0.14 ${print.hue})` : TONE_COLOUR[tone];
  const shouldAnimate = animate && !still;

  return (
    <svg
      viewBox={`0 0 ${EXTENT} ${EXTENT}`}
      width={px}
      height={px}
      className={cx("shrink-0 overflow-visible", className)}
      style={{ color: colour }}
      role="img"
      aria-label={label ?? `Visual fingerprint of ${hash}`}
    >
      {/*
        An invalid hash renders as an explicit blank rather than a plausible pattern. A picture that
        claims to be "the approved bytes" must not invent bytes.
      */}
      {!print.valid ? (
        <rect
          x={0.5}
          y={0.5}
          width={EXTENT - 1}
          height={EXTENT - 1}
          rx={UNIT * 0.5}
          fill="none"
          stroke="var(--line-strong)"
          strokeDasharray="3 3"
        />
      ) : (
        print.cells.map((cell) => {
          const span = (UNIT - GAP) * cell.scale;
          const offset = (UNIT - span) / 2;
          const x = cell.column * UNIT + offset;
          const y = cell.row * UNIT + offset;
          const isChanged = changedSet.has(cell.index);

          /*
             Unchanged cells recede rather than disappear when a diff is shown. Keeping them faintly
             visible preserves the shape of the whole grid, so a reader can see that the change is
             everywhere rather than in one corner -- which for a real substitution it is.
          */
          const baseOpacity = 0.28 + cell.scale * 0.62;
          const opacity = changedSet.size === 0 ? baseOpacity : isChanged ? 1 : 0.14;

          return (
            <motion.g
              key={cell.index}
              fill="currentColor"
              initial={shouldAnimate ? { opacity: 0, scale: 0.4 } : false}
              animate={{ opacity, scale: 1 }}
              transition={
                shouldAnimate
                  ? {
                      // Diagonal sweep: cells further from the origin land later, so the grid
                      // assembles as a wave instead of a flat fade.
                      delay: (cell.row + cell.column) * 0.016,
                      duration: 0.42,
                      ease: [0.22, 1, 0.36, 1],
                    }
                  : { duration: still ? 0 : 0.3 }
              }
              style={{ transformOrigin: `${cell.column * UNIT + UNIT / 2}px ${cell.row * UNIT + UNIT / 2}px` }}
            >
              <Glyph shape={cell.shape} x={x} y={y} span={span} />
            </motion.g>
          );
        })
      )}
    </svg>
  );
}

/**
 * Two fingerprints and the count of cells between them.
 *
 * Reads left to right as a sentence: this is what you approved, this is what is on disk, this many
 * of the 64 positions disagree. The arrow is not decoration -- it is the only thing telling a reader
 * which of the two came first.
 */
export function FingerprintDiff({
  approved,
  current,
  px = 132,
  labels = { approved: "approved", current: "on disk" },
}: {
  approved: string;
  current: string;
  px?: number;
  labels?: { approved: string; current: string };
}) {
  const still = useReducedMotion();

  const { left, right, diff } = useMemo(() => {
    const a = fingerprintOf(approved);
    const b = fingerprintOf(current);
    return { left: a, right: b, diff: fingerprintDiff(a, b) };
  }, [approved, current]);

  return (
    <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-8">
      <Panel
        label={labels.approved}
        hash={approved}
        print={left}
        tone="bonded"
        px={px}
        changed={diff.changed}
      />

      <div className="flex flex-col items-center gap-2">
        <motion.div
          aria-hidden
          className="text-2xl text-faint"
          animate={still ? {} : { x: [0, 5, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        >
          &rarr;
        </motion.div>
        <div className="text-center">
          <p className="font-display text-2xl leading-none text-revoked-ink">{diff.changed.length}</p>
          <p className="mt-1 shout text-label text-faint">
            of 64 differ
          </p>
        </div>
      </div>

      <Panel
        label={labels.current}
        hash={current}
        print={right}
        tone="revoked"
        px={px}
        changed={diff.changed}
      />
    </div>
  );
}

function Panel({
  label,
  hash,
  print,
  tone,
  px,
  changed,
}: {
  label: string;
  hash: string;
  print: Fingerprint;
  tone: Tone;
  px: number;
  changed: readonly number[];
}) {
  return (
    <figure className="flex flex-col items-center gap-3">
      <div className="rounded-2xl bg-sunken p-4 chunk">
        <HashFingerprint hash={hash} tone={tone} px={px} changed={changed} animate />
      </div>
      <figcaption className="text-center">
        <p className="shout text-label text-faint">{label}</p>
        {/* First and last four nibbles, so the caption ties the image back to the hex. */}
        <p className="hash mt-1 text-label text-muted">
          {print.valid ? `${print.normalised.slice(0, 4)}\u2026${print.normalised.slice(-4)}` : "unreadable"}
        </p>
      </figcaption>
    </figure>
  );
}

/**
 * A small inline mark, for table rows and list items.
 *
 * Gives every pin a face. Once a reader has seen a skill's fingerprint on the overview, the same
 * mark in a table row identifies it faster than a truncated hash does, and it is derived from the
 * same bytes so it cannot drift out of sync with the label beside it.
 */
export function FingerprintMark({ hash, px = 26, className }: { hash: string; px?: number; className?: string }) {
  return (
    <HashFingerprint
      hash={hash}
      px={px}
      className={cx("rounded-md", className)}
      label={`Fingerprint of ${hash}`}
    />
  );
}
