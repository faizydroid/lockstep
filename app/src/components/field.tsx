"use client";

/**
 * The background field: a lattice that drifts, with the two lockstep bars running through it.
 *
 * The flat radial wash it replaces was inoffensive and forgettable, which is the problem the whole
 * interface had. This gives the page a floor with some depth to it, and reuses the product's one
 * motif -- two bars that hold position relative to each other -- at a scale where it reads as
 * structure rather than as a logo.
 *
 * Deliberately cheap. Two SVG patterns and three transforms, no per-frame JavaScript and no canvas,
 * so it costs nothing on a laptop driving a projector. Fixed and behind everything, so it never
 * moves with scroll and never intercepts a pointer.
 */

import { motion, useReducedMotion } from "./motion";

export function Field() {
  const still = useReducedMotion();

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/*
        The lattice. Drifting diagonally at a pace that is almost subliminal -- fast enough to feel
        alive if you look for it, slow enough that it never competes with content.
      */}
      <motion.svg
        className="absolute inset-0 h-full w-full opacity-[0.55]"
        animate={still ? {} : { x: [0, 48], y: [0, 48] }}
        transition={{ duration: 26, repeat: Infinity, ease: "linear" }}
        style={{ width: "calc(100% + 48px)", height: "calc(100% + 48px)" }}
      >
        <defs>
          <pattern id="field-grid" width="48" height="48" patternUnits="userSpaceOnUse">
            {/* Dots rather than lines: a grid of rules reads as a spreadsheet, dots read as paper. */}
            <circle cx="0.75" cy="0.75" r="0.75" fill="var(--line-strong)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#field-grid)" />
      </motion.svg>

      {/* Colour pools, which carry the theme's temperature. */}
      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(70rem 45rem at 6% -14%, var(--wash-a), transparent 62%),
            radial-gradient(58rem 38rem at 104% 2%, var(--wash-b), transparent 58%),
            radial-gradient(48rem 34rem at 52% 116%, var(--wash-c), transparent 62%)
          `,
        }}
      />

      {/*
        The motif at wall scale: two long bars holding a constant offset as they breathe. They never
        converge, because that is the point -- the approved version and the running version stay
        locked apart by exactly the distance the owner agreed to.
      */}
      <motion.div
        className="absolute -right-24 top-[18%] hidden h-[3px] w-[42rem] rounded-pill lg:block"
        style={{ background: "linear-gradient(90deg, transparent, var(--bonded), transparent)" }}
        animate={still ? { opacity: 0.16 } : { opacity: [0.1, 0.22, 0.1], x: [0, -26, 0] }}
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -right-24 top-[calc(18%+22px)] hidden h-[3px] w-[42rem] rounded-pill lg:block"
        style={{ background: "linear-gradient(90deg, transparent, var(--pinned), transparent)" }}
        animate={still ? { opacity: 0.16 } : { opacity: [0.1, 0.22, 0.1], x: [0, -26, 0] }}
        // Same duration and easing, offset only in start time, so the pair keeps its spacing.
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut", delay: 0.9 }}
      />

      {/* A grain pass, which stops the large flat areas from banding on cheap panels. */}
      <div className="grain absolute inset-0 opacity-60" />
    </div>
  );
}
