"use client";

/**
 * Shared motion vocabulary.
 *
 * Centralised so movement means something consistent instead of each component inventing its own
 * timing. The rules this file encodes:
 *
 *   Entrances travel a short distance and settle. Nothing slides in from off-screen, because this
 *   is a reference tool people will open dozens of times, and theatrical entrances get tiresome by
 *   the third visit.
 *
 *   Lists stagger, but with a cap. Staggering communicates order; staggering forty rows at 40ms
 *   each means the last row lands a second and a half late, which reads as slow rather than
 *   considered.
 *
 *   Springs for anything a pointer drives, easing for anything time drives. A hover that eases
 *   feels laggy; an entrance that springs feels unserious.
 *
 *   Motion carries information or it does not ship. Every effect here answers a question: which
 *   row did this panel come from, is this number changing, how far through this page am I.
 *
 * Every export honours prefers-reduced-motion, and does so by removing movement rather than
 * removing the element, so nothing becomes invisible to someone who asked for stillness.
 */

import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "framer-motion";
import type { HTMLMotionProps, Transition, Variants } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/** Time-driven default. Slightly overshooting ease for a settled, mechanical feel. */
export const EASE_SOFT: Transition = {
  duration: 0.45,
  ease: [0.22, 1, 0.36, 1],
};

/** Pointer-driven default. Firm enough not to wobble under repeated hover. */
export const SPRING_FIRM: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 34,
  mass: 0.7,
};

export const SPRING_SOFT: Transition = {
  type: "spring",
  stiffness: 220,
  damping: 26,
  mass: 0.9,
};

/**
 * Deliberately underdamped, for the one or two moments that are allowed to be loud.
 *
 * Damping at 12 against stiffness 500 overshoots and settles back, which is the bounce that makes
 * a correct answer feel correct. It is wrong for anything a user triggers repeatedly -- a nav item
 * that wobbles is annoying by the fifth click -- so it is reserved for outcomes.
 */
export const SPRING_BOUNCE: Transition = {
  type: "spring",
  stiffness: 500,
  damping: 12,
  mass: 0.8,
};

/* ------------------------------------------------------------------ entrances */

/**
 * Fades and lifts a block into place.
 *
 * 14px, which is far enough to register as motion and near enough that the eye does not have to
 * track it.
 */
export function Reveal({
  children,
  delay = 0,
  y = 14,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const still = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={still ? { opacity: 1 } : { opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...EASE_SOFT, delay: still ? 0 : delay }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Reveals children in sequence once scrolled into view.
 *
 * `whileInView` rather than on mount, so a long page does not animate everything at once while
 * most of it is below the fold.
 */
export function RevealGroup({
  children,
  className,
  stagger = 0.05,
}: {
  children: ReactNode;
  className?: string;
  stagger?: number;
}) {
  const still = useReducedMotion();

  const variants: Variants = {
    hidden: {},
    shown: {
      transition: {
        staggerChildren: still ? 0 : stagger,
        delayChildren: 0.02,
      },
    },
  };

  return (
    <motion.div
      className={className}
      variants={variants}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, margin: "-60px" }}
    >
      {children}
    </motion.div>
  );
}

/** A single item inside RevealGroup. Inherits the parent's stagger. */
export function RevealItem({
  children,
  className,
  y = 12,
}: {
  children: ReactNode;
  className?: string;
  y?: number;
}) {
  const still = useReducedMotion();

  const variants: Variants = {
    hidden: still ? { opacity: 1 } : { opacity: 0, y },
    shown: { opacity: 1, y: 0, transition: EASE_SOFT },
  };

  return (
    <motion.div className={className} variants={variants}>
      {children}
    </motion.div>
  );
}

/**
 * Scales in with an overshoot. The arrival animation of this visual language.
 *
 * Distinct from Reveal, which travels vertically and settles flat. Pop grows from 88% past 100% and
 * back, which reads as something landing rather than something fading up. Used for outcome panels
 * and for the mascot, not for body content, where it would be exhausting.
 */
export function Pop({
  children,
  delay = 0,
  className,
  from = 0.88,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  from?: number;
}) {
  const still = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={still ? { opacity: 1, scale: 1 } : { opacity: 0, scale: from }}
      animate={{ opacity: 1, scale: 1 }}
      transition={still ? { duration: 0 } : { ...SPRING_BOUNCE, delay }}
    >
      {children}
    </motion.div>
  );
}

/**
 * A short horizontal shake, for a refusal.
 *
 * Duolingo shakes the answer box when you get it wrong, and the reason it works is that the motion
 * is a rejection: it returns to exactly where it started, so nothing was accomplished. Four
 * reversals over 400ms, which is long enough to read and short enough not to feel punitive.
 *
 * Keyed by `trigger` so the same outcome can be replayed. Under reduced motion the shake is dropped
 * and the caller's colour and copy changes carry the message instead.
 */
export function Shake({
  children,
  trigger,
  className,
}: {
  children: ReactNode;
  /** Any value that changes when the shake should replay. */
  trigger: string | number;
  className?: string;
}) {
  const still = useReducedMotion();

  if (still) return <div className={className}>{children}</div>;

  return (
    <motion.div
      key={trigger}
      className={className}
      initial={{ x: 0 }}
      animate={{ x: [0, -9, 7, -5, 3, 0] }}
      transition={{ duration: 0.4, ease: "easeInOut" }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Particles thrown outward from the centre, for a successful outcome.
 *
 * Deterministic rather than random: the angles are evenly spaced and the per-particle variation
 * comes from the index, so the same event produces the same burst every time. Random confetti in a
 * component that re-renders produces a different burst on every render, which is both distracting
 * and impossible to screenshot consistently for a demo.
 *
 * Purely decorative, so it is aria-hidden and absent entirely under reduced motion.
 */
export function Burst({
  trigger,
  count = 14,
  tone = "var(--bonded)",
}: {
  trigger: string | number;
  count?: number;
  tone?: string;
}) {
  const still = useReducedMotion();
  if (still) return null;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-10 overflow-visible">
      {Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2;
        // Alternating radius and size, so the burst has depth rather than reading as one ring.
        const radius = 54 + (i % 3) * 26;
        const size = i % 2 === 0 ? 8 : 5;
        return (
          <motion.span
            key={`${trigger}-${i}`}
            className="absolute top-1/2 left-1/2 rounded-pill"
            style={{ width: size, height: size, background: tone }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 0.4 }}
            animate={{
              x: Math.cos(angle) * radius,
              // Bias upward, so the burst behaves as if it has some lift rather than expanding flat.
              y: Math.sin(angle) * radius - 14,
              opacity: 0,
              scale: 1,
            }}
            transition={{ duration: 0.72 + (i % 3) * 0.1, ease: [0.22, 1, 0.36, 1] }}
          />
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------- gestures */

/**
 * Lifts on hover and yields on press.
 *
 * The press state matters more than the hover: a 1px settle on click is what makes a surface feel
 * like it responded, and it is the cheapest possible affordance on a touch device where hover
 * never fires.
 */
export function Pressable({
  children,
  className,
  lift = 3,
  ...rest
}: HTMLMotionProps<"div"> & { children: ReactNode; className?: string; lift?: number }) {
  const still = useReducedMotion();

  // Spread conditionally rather than passing undefined. Under exactOptionalPropertyTypes an
  // optional prop and a prop explicitly set to undefined are different things.
  const gestures = still ? {} : { whileHover: { y: -lift }, whileTap: { y: -1, scale: 0.995 } };

  return (
    <motion.div className={className} transition={SPRING_FIRM} {...gestures} {...rest}>
      {children}
    </motion.div>
  );
}

/**
 * A highlight that tracks the pointer across a surface.
 *
 * Two motion values written directly rather than React state, so the pointer move never triggers a
 * render -- at this size a state update per mousemove is visibly janky. The highlight is a
 * radial gradient positioned from those values and revealed only on hover, which gives a large
 * card a sense of material without adding a border or a shadow that would compete with the
 * content.
 *
 * Skipped entirely under reduced motion and on touch, where there is no pointer to track.
 */
export function Spotlight({
  children,
  className,
  strength = 0.09,
}: {
  children: ReactNode;
  className?: string;
  strength?: number;
}) {
  const still = useReducedMotion();
  const x = useMotionValue(-9999);
  const y = useMotionValue(-9999);
  const opacity = useMotionValue(0);
  const ref = useRef<HTMLDivElement>(null);

  const background = useTransform(
    [x, y],
    ([latestX, latestY]: number[]) =>
      `radial-gradient(22rem circle at ${latestX}px ${latestY}px, color-mix(in oklab, var(--pinned) ${strength * 100}%, transparent), transparent 65%)`,
  );

  if (still) return <div className={className}>{children}</div>;

  return (
    <div
      ref={ref}
      className={className}
      onPointerMove={(event) => {
        if (event.pointerType === "touch") return;
        const box = ref.current?.getBoundingClientRect();
        if (box === undefined) return;
        x.set(event.clientX - box.left);
        y.set(event.clientY - box.top);
        opacity.set(1);
      }}
      onPointerLeave={() => opacity.set(0)}
    >
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background, opacity }}
        transition={{ opacity: { duration: 0.25 } }}
      />
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------- numbers */

/**
 * Counts a number up when it first comes into view, and again whenever it changes.
 *
 * Worth the complexity on this dashboard specifically: several figures update when the live chain
 * read lands and replaces the seeded sample, and a silent swap looks like the page reloaded. A
 * count draws the eye to the fact that the value moved.
 *
 * Integers are rendered through the supplied formatter rather than interpolated as text, so a
 * bond still prints in its own decimals rather than becoming a bare float mid-animation.
 */
export function CountUp({
  value,
  format = (n) => String(Math.round(n)),
  duration = 0.9,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const still = useReducedMotion();
  const [shown, setShown] = useState(still ? value : 0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    if (still) {
      setShown(value);
      return;
    }

    const node = ref.current;
    if (node === null) return;

    const run = () => {
      const from = started.current ? shown : 0;
      started.current = true;
      const start = performance.now();
      let frame = 0;

      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / (duration * 1000));
        // Same easing curve as EASE_SOFT, so a counting number and a sliding panel agree.
        const eased = 1 - Math.pow(1 - t, 3);
        setShown(from + (value - from) * eased);
        if (t < 1) frame = requestAnimationFrame(tick);
      };

      frame = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(frame);
    };

    // Only count once visible, so figures below the fold are not already finished on arrival.
    let cleanup: (() => void) | undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          cleanup = run();
          observer.disconnect();
        }
      },
      { rootMargin: "-40px" },
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
      cleanup?.();
    };
    // `shown` is deliberately not a dependency: it changes every frame and would restart the run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration, still]);

  return (
    <span ref={ref} className={className}>
      {format(shown)}
    </span>
  );
}

/* ------------------------------------------------------------------ disclosure */

/**
 * Height-collapsing disclosure.
 *
 * Animating to `auto` needs the two-keyframe form; a plain height transition to auto does not
 * interpolate. Overflow stays hidden throughout so descenders do not spill past the edge
 * mid-collapse.
 */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const still = useReducedMotion();

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          key="content"
          initial={still ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={still ? { height: "auto", opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{ height: EASE_SOFT, opacity: { duration: 0.2 } }}
          style={{ overflow: "hidden" }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/* --------------------------------------------------------------------- scroll */

/**
 * A progress rail across the top of the viewport.
 *
 * These pages are long and mostly text, and the browser scrollbar is easy to miss on a dark
 * ground. Spring-smoothed so a trackpad fling does not make it jitter.
 */
export function ScrollProgress() {
  const still = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const width = useSpring(scrollYProgress, { stiffness: 140, damping: 26, restDelta: 0.001 });

  if (still) return null;

  return (
    <motion.div
      aria-hidden
      className="fixed inset-x-0 top-0 z-50 h-[2px] origin-left bg-pinned"
      style={{ scaleX: width }}
    />
  );
}

/**
 * Fades and lifts a section as it enters, proportional to scroll.
 *
 * Used sparingly. Applied to everything it would turn reading into a series of small waits, so it
 * is reserved for the one or two blocks that are meant to land as statements.
 */
export function Parallax({
  children,
  distance = 40,
  className,
}: {
  children: ReactNode;
  distance?: number;
  className?: string;
}) {
  const still = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });

  const y = useTransform(scrollYProgress, [0, 1], [distance, -distance]);

  if (still) return <div className={className}>{children}</div>;

  return (
    <div ref={ref} className={className}>
      <motion.div style={{ y }}>{children}</motion.div>
    </div>
  );
}

/* ---------------------------------------------------------------- transitions */

/**
 * Wraps a route's content so navigation has a direction.
 *
 * Keyed on the pathname by the caller, so leaving and arriving are distinct animations rather than
 * a hard swap. Deliberately short: a page transition that takes longer than about a quarter of a
 * second turns every click into a wait.
 */
export function RouteTransition({ routeKey, children }: { routeKey: string; children: ReactNode }) {
  const still = useReducedMotion();

  if (still) return <>{children}</>;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={routeKey}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

export { AnimatePresence, motion, useReducedMotion };
