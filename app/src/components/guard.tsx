"use client";

/**
 * Guard, the mascot.
 *
 * Duolingo has an owl, and the owl is not decoration -- it is how the product delivers news. Duo
 * celebrates a streak and looks stricken when you break one, which turns a status change into
 * something with a face attached. That mechanism is worth borrowing here, because this app's whole
 * job is to deliver one of two verdicts about money that was about to move, and a coloured badge is
 * a weak way to say "the call you authorised was refused".
 *
 * Guard is a shield, which is the obvious shape for the job, and its eyebrows are the two bars of
 * the Lockstep mark. That is the one piece of real brand continuity available: the same two bars
 * that appear in the background field and the logo become the character's most expressive feature.
 * Eyebrows carry more emotion per pixel than a mouth does, so the motif ends up doing the heavy
 * lifting rather than being pasted on.
 *
 * Four moods, each tied to a state the system can actually be in. Nothing here is a mood the data
 * cannot justify:
 *
 *   settled   every approved skill still matches its approved bytes
 *   watching  idle, nothing to report, the resting state
 *   alarmed   drift detected -- bytes changed under an approved version string
 *   blocked   a call was refused on chain
 *
 * Accessibility: the whole thing is one `role="img"` with a label that states the mood in words, so
 * a screen reader gets the verdict rather than a list of circles. The colour is never the only
 * signal -- the eyebrows and mouth change shape too, which matters for the ~8% of men with red-green
 * colour deficiency, for whom the settled green and the blocked red are close to identical.
 */

import { motion, useReducedMotion } from "framer-motion";

// From lib rather than from ./ui: ui.tsx imports this module now, because Empty draws the mascot.
import { cx } from "@/lib/cx";

export type Mood = "settled" | "watching" | "alarmed" | "blocked";

/**
 * Per-mood geometry.
 *
 * Kept as data rather than branching inside the JSX so every mood is described in one place and it
 * is obvious at a glance that all four define the same fields. `brow` values are rotation in
 * degrees about each bar's inner end; positive tilts the outer end down, which reads as stern.
 */
const MOODS: Record<
  Mood,
  {
    /** Bright face token for the shell. */
    fill: string;
    shade: string;
    /** Eyebrow rotation and vertical offset. */
    browTilt: number;
    browLift: number;
    /** Mouth path, drawn in a 120x128 viewBox. */
    mouth: string;
    /** Pupil offset, for a character that is looking somewhere. */
    lookX: number;
    lookY: number;
    /** How wide the eyes are open, 1 being neutral. */
    eyeOpen: number;
    label: string;
  }
> = {
  settled: {
    fill: "var(--bonded)",
    shade: "var(--bonded-shade)",
    browTilt: -6,
    browLift: -2,
    // An open smile. Curve below the baseline, closed so it can take a fill.
    mouth: "M 46 82 Q 60 96 74 82 Q 60 88 46 82 Z",
    lookX: 0,
    lookY: 0,
    eyeOpen: 1,
    label: "Guard is settled: every approved skill still matches its approved bytes.",
  },
  watching: {
    fill: "var(--pinned)",
    shade: "var(--pinned-shade)",
    browTilt: 0,
    browLift: 0,
    // A small neutral line.
    mouth: "M 50 85 Q 60 89 70 85 Q 60 87 50 85 Z",
    // Glancing slightly aside, which is what makes an idle character look alive rather than blank.
    lookX: 2.5,
    lookY: 1,
    eyeOpen: 1,
    label: "Guard is watching. Nothing to report.",
  },
  alarmed: {
    fill: "var(--attention)",
    shade: "var(--attention-shade)",
    // Both brows up and out: surprise, not anger.
    browTilt: -16,
    browLift: -6,
    // A small open O.
    mouth: "M 60 84 m -8 0 a 8 7 0 1 0 16 0 a 8 7 0 1 0 -16 0 Z",
    lookX: 0,
    lookY: -1,
    eyeOpen: 1.22,
    label: "Guard is alarmed: bytes changed under a version string you already approved.",
  },
  blocked: {
    fill: "var(--revoked)",
    shade: "var(--revoked-shade)",
    // Brows angled down toward the nose: the universal stern face.
    browTilt: 15,
    browLift: 2,
    // A flat, firm line. No curve at all, which reads as unimpressed rather than sad.
    mouth: "M 48 86 L 72 86 L 72 89 L 48 89 Z",
    lookX: 0,
    lookY: 0,
    eyeOpen: 0.72,
    label: "Guard blocked a call: the skill on disk is not the skill you approved.",
  },
};

/**
 * The character.
 *
 * Three layers of motion, each with a different job and a different trigger:
 *
 *   The mood transition springs, because it is a reaction. Colour, eyebrows and mouth all move at
 *   once so the change reads as one expression rather than three parts updating.
 *
 *   An idle bob loops. It is 3px over three seconds, small enough to sit under conversation and
 *   large enough that the character does not look frozen. This is the piece that separates a mascot
 *   from an icon.
 *
 *   A blink loops on its own slower, offset cycle, so the two never sync into a single tic.
 *
 * All three are dropped under reduced motion, where the mood still changes -- just instantly.
 */
export function Guard({
  mood = "watching",
  size = 128,
  className,
  bob = true,
  label,
}: {
  mood?: Mood;
  size?: number;
  className?: string;
  /** Off for a Guard sitting inline in a row, where a bobbing icon is distracting. */
  bob?: boolean;
  /**
   * Overrides the spoken label when the mood's default narrative is wrong for the context.
   *
   * Needed because a face is more general than a sentence. The `blocked` mood -- stern brows, flat
   * mouth -- is the right expression both for a call refused at settlement and for a publisher caught
   * equivocating, but those are different facts. The default label describes the refusal, so the
   * scoreboard passes its own. Without this a screen reader on the overview was told a call had been
   * blocked when what had actually happened was a publisher losing their bond.
   */
  label?: string;
}) {
  const still = useReducedMotion();
  const m = MOODS[mood];

  const spring = { type: "spring" as const, stiffness: 320, damping: 20, mass: 0.7 };

  return (
    <motion.div
      role="img"
      aria-label={label ?? m.label}
      className={cx("relative shrink-0 select-none", className)}
      style={{ width: size, height: size * (128 / 120) }}
      animate={still || !bob ? {} : { y: [0, -3, 0] }}
      transition={
        still || !bob ? {} : { duration: 3.1, repeat: Infinity, ease: "easeInOut" }
      }
    >
      <svg viewBox="0 0 120 128" width="100%" height="100%" aria-hidden>
        {/*
          The shell. A heraldic shield: square shoulders, straight sides, tapering to a point.
          Stroked in --on-face rather than black so it matches the label colour used on every solid
          fill in the kit, and at 5 units, which lands near the 2px of the CSS borders once scaled.
        */}
        <motion.path
          d="M 16 18 C 16 11 21 6 28 6 L 92 6 C 99 6 104 11 104 18 L 104 68 C 104 99 63 120 60 121.5 C 57 120 16 99 16 68 Z"
          animate={{ fill: m.fill }}
          transition={spring}
          stroke="var(--on-face)"
          strokeWidth={5}
          strokeLinejoin="round"
        />

        {/*
          A darker inner band along the bottom of the shield.
          The same trick as the hard bottom shadow on the buttons: it gives the shape a lit top and
          a shaded underside, so it reads as a solid object rather than a flat sticker.
        */}
        <motion.path
          d="M 16 84 C 22 100 50 117 60 121.5 C 70 117 98 100 104 84 L 104 68 C 104 99 63 120 60 121.5 C 57 120 16 99 16 68 Z"
          animate={{ fill: m.shade }}
          transition={spring}
          opacity={0.55}
        />

        {/* Eyes. Whites are fixed; only the pupils move and blink. */}
        <Eye cx={44} m={m} still={still} spring={spring} />
        <Eye cx={76} m={m} still={still} spring={spring} />

        {/*
          The eyebrows, which are the Lockstep two-bar mark.

          Rotated about their inner ends so they converge or fly apart, which is where nearly all of
          the expression comes from.

          The transform lives on a wrapping <g> rather than on the rect. On an SVG rect, `y` is an
          attribute and `rotate` is a transform, and animating both on one element leaves framer to
          guess which system `y` belongs to. Moving rotation and translation onto a group makes it
          unambiguous: the rect keeps static geometry, the group is transformed.
        */}
        <motion.g
          animate={{ rotate: m.browTilt, y: m.browLift }}
          transition={spring}
          style={{ originX: "52px", originY: "33px" }}
        >
          <rect x={30} y={30} width={22} height={6} rx={3} fill="var(--on-face)" />
        </motion.g>
        <motion.g
          animate={{ rotate: -m.browTilt, y: m.browLift }}
          transition={spring}
          style={{ originX: "68px", originY: "33px" }}
        >
          <rect x={68} y={30} width={22} height={6} rx={3} fill="var(--on-face)" />
        </motion.g>

        {/*
          The mouth.

          Cut rather than tweened. The four shapes are structurally different paths -- a quadratic
          smile, two arcs for the open O, a straight-sided rectangle for the flat line -- and path
          interpolation needs matching command sequences. Rewriting all four to share a command
          structure would flatten the shapes into compromises for a transition nobody would notice,
          since the colour and eyebrows are springing at the same moment and carry the change.
        */}
        <path d={m.mouth} fill="var(--on-face)" />
      </svg>
    </motion.div>
  );
}

/**
 * One eye: a white capsule with a pupil that tracks and blinks.
 *
 * The blink is scaleY on the pupil group with the white left alone, which is a cheap approximation
 * of a lid and holds up at this size. Offsetting the delay by the eye's x position keeps the two
 * from blinking in lockstep, which is unsettling in a way that is hard to name.
 */
function Eye({
  cx: x,
  m,
  still,
  spring,
}: {
  cx: number;
  m: (typeof MOODS)[Mood];
  still: boolean | null;
  spring: object;
}) {
  return (
    <g>
      <motion.ellipse
        cx={x}
        cy={54}
        rx={13}
        fill="#ffffff"
        stroke="var(--on-face)"
        strokeWidth={4}
        animate={{ ry: 14 * m.eyeOpen }}
        transition={spring}
      />
      <motion.g
        animate={still ? {} : { scaleY: [1, 1, 0.08, 1, 1] }}
        transition={
          still
            ? {}
            : {
                duration: 4.4,
                repeat: Infinity,
                times: [0, 0.86, 0.9, 0.94, 1],
                delay: x === 44 ? 0 : 0.04,
                ease: "linear",
              }
        }
        style={{ originX: `${x}px`, originY: "54px" }}
      >
        <motion.circle
          r={6}
          fill="var(--on-face)"
          animate={{ cx: x + m.lookX, cy: 54 + m.lookY }}
          transition={spring}
        />
        {/* Catchlight. One small dot is the difference between an eye and a hole. */}
        <motion.circle
          r={2}
          fill="#ffffff"
          animate={{ cx: x + m.lookX + 2.2, cy: 54 + m.lookY - 2.2 }}
          transition={spring}
        />
      </motion.g>
    </g>
  );
}

/**
 * Guard with a speech bubble beside it.
 *
 * The pairing is the actual unit of communication, so it is a component rather than something each
 * page assembles. Stacks under `sm` because a 128px character beside a bubble leaves the bubble
 * about nine characters wide on a phone.
 */
export function GuardSays({
  mood = "watching",
  children,
  size = 112,
  className,
  label,
}: {
  mood?: Mood;
  children: React.ReactNode;
  size?: number;
  className?: string;
  /** Passed through to Guard. See the note on its `label` prop. */
  label?: string;
}) {
  const tone =
    mood === "settled"
      ? "bonded"
      : mood === "alarmed"
        ? "attention"
        : mood === "blocked"
          ? "revoked"
          : "pinned";

  return (
    <div className={cx("flex flex-col items-center gap-4 sm:flex-row sm:items-start", className)}>
      {/*
        The bubble text is already in the document, so repeating it in Guard's label would make a
        screen reader read the same sentence twice. `label` therefore states the face, and the bubble
        states the detail.
      */}
      <Guard mood={mood} size={size} {...(label === undefined ? {} : { label })} />
      <SpeechFromGuard tone={tone}>{children}</SpeechFromGuard>
    </div>
  );
}

/**
 * The bubble half of GuardSays.
 *
 * Imported lazily through a local re-declaration rather than from ui.tsx directly, to keep the
 * import graph one-directional: ui.tsx knows nothing about the mascot, and the mascot file is the
 * only place that knows both.
 */
function SpeechFromGuard({
  tone,
  children,
}: {
  tone: "bonded" | "pinned" | "attention" | "revoked";
  children: React.ReactNode;
}) {
  const skin: Record<typeof tone, string> = {
    bonded: "bg-bonded-tint text-bonded-ink [--line:var(--bonded-ink)]",
    pinned: "bg-pinned-tint text-pinned-ink [--line:var(--pinned-ink)]",
    attention: "bg-attention-tint text-attention-ink [--line:var(--attention-ink)]",
    revoked: "bg-revoked-tint text-revoked-ink [--line:var(--revoked-ink)]",
  };
  const fill: Record<typeof tone, string> = {
    bonded: "bg-bonded-tint",
    pinned: "bg-pinned-tint",
    attention: "bg-attention-tint",
    revoked: "bg-revoked-tint",
  };

  /*
   * The tone class goes on the wrapper so both the bubble and its tail sit inside the scope that
   * defines `--line`. With it on the bubble itself, the tail is a sibling and resolves the token from
   * the theme default, which gives a coloured bubble a grey tail.
   */
  return (
    <div className={cx("relative w-full", skin[tone])}>
      <div className="chunk rounded-2xl px-5 py-4 text-sm leading-relaxed font-bold">{children}</div>
      {/*
        The tail. A rotated square with two borders showing, offset by half its own width so it
        straddles the bubble edge and its unbordered corner hides the seam. On small screens the
        bubble sits below Guard, so the tail moves to the top edge.
      */}
      <span
        aria-hidden
        className={cx(
          "absolute size-3 border-b border-l border-[var(--line)]",
          fill[tone],
          "-top-[7px] left-1/2 -translate-x-1/2 rotate-[135deg]",
          "sm:top-7 sm:-left-[7px] sm:translate-x-0 sm:rotate-45",
        )}
      />
    </div>
  );
}
