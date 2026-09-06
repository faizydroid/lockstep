"use client";

/**
 * The settlement gate, as something you can operate.
 *
 * Every other surface in this app describes enforcement after the fact: a list of pins, a table of
 * refusals. None of them show the thing itself -- a call arriving at the guard, the guard comparing
 * the bytes it was handed against the bytes the owner approved, and the call either settling or
 * being turned away. That moment is the entire product and it was only ever prose.
 *
 * So it is a toggle. Flip the publisher between shipping the approved version and shipping something
 * else, and watch what happens to the call. Nothing here is a mock-up: both hashes are the real ones
 * from the end-to-end run, and the refusal is the real error code.
 *
 * REBUILT after a reader said they could not follow it. The previous version failed in five specific
 * ways, and each fix below is aimed at one of them:
 *
 *   1. It was one long rail that was 90% empty, with no labels at either end. There was nothing to
 *      say where a call came from or where it was going. Now there are three named stations -- the
 *      skill, the guard, settlement -- so the diagram reads as a journey with a start and an end.
 *
 *   2. The gate was a 2.5px sliver, scaled to 20% height when open. Nobody would read that as a
 *      gate. It is now a pair of thick leaves on the guard's exit that visibly meet when they close.
 *
 *   3. The travelling token overlapped the word "settled" at rest, which looked like a rendering
 *      bug. The token now lives inside whichever connector is active and never shares space with a
 *      label.
 *
 *   4. The two fingerprints were 52px and captioned "approved" and "attested". Too small to compare,
 *      and "attested" is jargon. They are bigger, they sit inside the guard where the comparison
 *      actually happens, and they are captioned "the code you approved" and "the code that is
 *      asking".
 *
 *   5. Nothing indicated the toggle was a control, or that the publisher was the one doing the
 *      shipping. The steps are now numbered, the switch has a subject and an explicit nudge, and
 *      each step says what it is for.
 */

import { useEffect, useRef, useState } from "react";

import { fingerprintDiff, fingerprintOf } from "@/lib/fingerprint";
import { APPROVED_HASH, DRIFTED_HASH } from "@/lib/fixtures";
import { shortHash } from "@/lib/format";

import { REFUSAL_STEP } from "@/lib/quickstart";

import { HashFingerprint } from "./fingerprint";
import { useSettings } from "./settings";
import {
  AnimatePresence,
  Burst,
  SPRING_FIRM,
  SPRING_SOFT,
  Shake,
  motion,
  useReducedMotion,
} from "./motion";
import { Button, Pill, cx } from "./ui";

type Shipping = "approved" | "swapped";

/** Where the call is in its journey. */
type Phase = "idle" | "travelling" | "checking" | "settled" | "refused";

export function SettlementGate() {
  const still = useReducedMotion();
  const { completeStep } = useSettings();
  const [shipping, setShipping] = useState<Shipping>("approved");
  const [phase, setPhase] = useState<Phase>("idle");
  /* Bumped on every run, so Burst and Shake replay rather than staying mounted and inert. */
  const [run, setRun] = useState(0);
  /*
   * Pending timers, so a second run can cancel the first.
   *
   * Without this, hammering "Run it again" starts overlapping sequences and the phases interleave --
   * the gate can end up closed while the verdict says settled. The effect below already cleans up
   * its own timers on re-run; this gives the manual replay the same guarantee.
   */
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
  };

  const attested = shipping === "approved" ? APPROVED_HASH : DRIFTED_HASH;
  const matches = shipping === "approved";

  const diff = fingerprintDiff(fingerprintOf(APPROVED_HASH), fingerprintOf(attested));
  const changed = matches ? 0 : diff.changed.length;

  /*
   * The run is a small timed sequence rather than a chain of animation callbacks.
   *
   * Explicit phases mean the visual state is inspectable and cannot get stuck half-transitioned if a
   * reader flips the switch mid-run -- the effect below simply restarts. Callback chaining looked
   * cleaner and left the token stranded in the middle of the track.
   *
   * Slower than the previous version on purpose. It used to be finished before a reader had looked
   * at it, which is part of why the thing was hard to follow: there was no perceptible moment of
   * comparison, just a token that was already at the end.
   */
  /** Schedules one full run. Cancels anything already in flight first. */
  const start = (leadIn: number) => {
    clearTimers();
    setPhase("idle");
    timers.current = [
      window.setTimeout(() => setPhase("travelling"), leadIn),
      window.setTimeout(() => setPhase("checking"), leadIn + 990),
      window.setTimeout(() => {
        setPhase(matches ? "settled" : "refused");
        setRun((n) => n + 1);
      }, leadIn + 2090),
    ];
  };

  useEffect(() => {
    if (still) {
      clearTimers();
      setPhase(matches ? "settled" : "refused");
      return;
    }

    start(260);
    return clearTimers;
    // `start` is redeclared every render and would retrigger this on every state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipping, matches, still]);

  const replay = () => start(80);

  /*
   * A refusal the reader actually caused satisfies the quickstart's second step.
   *
   * That step used to be satisfied by arriving at `/drift`, which is true of someone who landed there and
   * scrolled past everything. Watching this gate close is a strictly stronger event: it required flipping
   * the switch and waiting for the sequence. The route visit stays as an alternative satisfier, so nobody
   * loses credit — this just adds the better trigger, and makes the diagram load-bearing rather than
   * ornamental.
   *
   * Only on `refused`. A settled call is the happy path and demonstrates nothing about enforcement.
   */
  useEffect(() => {
    if (phase === "refused") completeStep(REFUSAL_STEP);
  }, [phase, completeStep]);

  return (
    <div className="pop relative rounded-3xl bg-panel p-6 sm:p-8">
      <div className="space-y-8">
        <header className="space-y-3">
          <p className="shout text-label text-faint">The moment of enforcement</p>
          {/*
            h2, was h3. The gate renders first on `/drift`, so the page's outline used to open at level three,
            descend to h4 for the step titles, and then jump back up to the h2 that `Section` emits — a
            document whose heading levels go 3, 4, 2. Level two here and level three below makes the outline
            read in order under the route's h1.
          */}
          <h2 className="font-display text-2xl leading-tight text-text sm:text-3xl">
            Watch a call reach the guard
          </h2>
          {/*
            A plain-language framing, which the previous version had nowhere.
            Someone meeting this panel cold needs to be told what they are looking at and that they
            are allowed to touch it, before any diagram will mean anything.
          */}
          <p className="measure text-sm leading-relaxed font-semibold text-muted">
            Before an agent can move money, the guard checks that the code asking is the exact code
            you approved &mdash; byte for byte. Flip the switch below to change what the publisher
            ships, and watch the same call succeed or get turned away.
          </p>
        </header>

        <Step
          n={1}
          title="Choose what the publisher ships"
          hint="This is the only thing you control here. Everything after it is the guard reacting."
        >
          <Switch shipping={shipping} onChange={setShipping} />
        </Step>

        <Step
          n={2}
          title="The call travels to the guard"
          hint="The guard compares two hashes. It never reads the code, so it cannot be talked round."
        >
          <Journey
            phase={phase}
            matches={matches}
            attested={attested}
            changedCells={matches ? [] : diff.changed}
            changed={changed}
            still={still ?? false}
          />
        </Step>

        <Step n={3} title="The guard decides">
          <Verdict phase={phase} matches={matches} changed={changed} onReplay={replay} run={run} />
        </Step>
      </div>
    </div>
  );
}

/**
 * A numbered step.
 *
 * Duolingo teaches in explicit sequence, and that is the part worth copying here rather than the
 * colours. The previous version put three zones on screen with no indication that the first drove
 * the second which produced the third, and left the reader to infer the causality.
 */
function Step({
  n,
  title,
  hint,
  children,
}: {
  n: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="pop-sm grid size-7 shrink-0 place-items-center rounded-pill bg-pinned text-note font-extrabold text-on-face [--pop:var(--pinned-shade)]"
        >
          {n}
        </span>
        <div className="min-w-0">
          <h3 className="font-display text-base leading-tight text-text">
            <span className="sr-only">Step {n}. </span>
            {title}
          </h3>
          {hint === undefined ? null : (
            <p className="measure mt-0.5 text-xs leading-relaxed font-semibold text-faint">{hint}</p>
          )}
        </div>
      </div>
      <div className="sm:pl-10">{children}</div>
    </section>
  );
}

/**
 * The publisher's behaviour, as a two-position switch.
 *
 * Now carries its subject. The previous labels were "Ships approved" and "Swaps the bytes", with the
 * publisher named nowhere on the control -- so the reader was shown a verb with no actor and had to
 * guess who was doing it. A legend fixes that in three words.
 */
function Switch({
  shipping,
  onChange,
}: {
  shipping: Shipping;
  onChange: (next: Shipping) => void;
}) {
  const options: readonly { value: Shipping; label: string; hint: string }[] = [
    {
      value: "approved",
      label: "The version you approved",
      hint: "The bytes on disk are the bytes the account owner agreed to run.",
    },
    {
      value: "swapped",
      label: "Different code, same version number",
      hint: "The shape of a real supply-chain attack: nothing about the label changes.",
    },
  ];

  return (
    <fieldset className="space-y-2">
      <legend className="shout mb-2 text-label text-faint">The publisher ships&hellip;</legend>

      <div className="flex flex-col gap-2 sm:flex-row">
        {options.map((option) => {
          const active = shipping === option.value;
          return (
            <label
              key={option.value}
              title={option.hint}
              className={cx(
                "press relative flex-1 cursor-pointer rounded-2xl px-4 py-3 text-left transition-colors",
                active
                  ? option.value === "approved"
                    ? "pop bg-bonded-tint [--line:var(--bonded)] [--pop:var(--bonded-shade)]"
                    : "pop bg-revoked-tint [--line:var(--revoked)] [--pop:var(--revoked-shade)]"
                  : "chunk bg-panel hover:bg-raise",
              )}
            >
              <input
                type="radio"
                name="shipping"
                checked={active}
                onChange={() => onChange(option.value)}
                className="peer sr-only"
              />
              <span className="flex items-center gap-2">
                {/* A real radio dot, because two unlabelled tinted boxes do not read as a choice. */}
                <span
                  aria-hidden
                  className={cx(
                    "grid size-5 shrink-0 place-items-center rounded-pill border",
                    active
                      ? option.value === "approved"
                        ? "border-bonded-ink"
                        : "border-revoked-ink"
                      : "border-line-strong",
                  )}
                >
                  {active ? (
                    <motion.span
                      layout
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={SPRING_FIRM}
                      className={cx(
                        "size-2.5 rounded-pill",
                        option.value === "approved" ? "bg-bonded" : "bg-revoked",
                      )}
                    />
                  ) : null}
                </span>
                <span
                  className={cx(
                    "text-sm leading-snug font-bold",
                    active
                      ? option.value === "approved"
                        ? "text-bonded-ink"
                        : "text-revoked-ink"
                      : "text-muted",
                  )}
                >
                  {option.label}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      <p className="text-xs font-semibold text-faint">
        Try both. The call is identical either way &mdash; only the code behind it changes.
      </p>
    </fieldset>
  );
}

/* --------------------------------------------------------------------- journey */

/**
 * Three named stations, with the call travelling between them.
 *
 * The structural fix for the old single rail. Splitting the path into two connectors means the token
 * is always inside a well-defined segment rather than positioned by a percentage across an empty
 * band, so it can never come to rest on top of a label. It also lets each leg carry its own state:
 * the first leg is the approach, the second only exists if the guard let the call through.
 *
 * Stacks vertically under `lg`, where three boxes side by side would each be about nine characters
 * wide. The connectors rotate a quarter turn with it.
 */
function Journey({
  phase,
  matches,
  attested,
  changedCells,
  changed,
  still,
}: {
  phase: Phase;
  matches: boolean;
  attested: string;
  changedCells: readonly number[];
  changed: number;
  still: boolean;
}) {
  const closed = phase === "refused" || (phase === "checking" && !matches);
  const arrived = phase === "checking" || phase === "settled" || phase === "refused";

  return (
    <div className="space-y-3">
      {/*
        One spoken summary for the whole diagram.

        A screen reader met with this previously got a pile of decorative divs and two fingerprint
        images. The sequence is the content, so it is stated once here, and everything visual below
        is aria-hidden.
      */}
      <p aria-live="polite" className="sr-only">
        {PHASE_SPEECH[phase]({ matches, changed })}
      </p>

      <div
        aria-hidden
        className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,0.85fr)_auto_minmax(0,1.5fr)_auto_minmax(0,0.85fr)]"
      >
        <Station
          label="The skill"
          caption="Asks to move money"
          tone="neutral"
          active={phase === "idle" || phase === "travelling"}
        >
          <span className="hash text-label text-muted">swap-router@2.1.0</span>
        </Station>

        <Connector
          show={phase === "idle" || phase === "travelling" || phase === "checking"}
          progress={phase === "idle" ? 0 : 1}
          bounce={phase === "refused"}
          tone="pinned"
          still={still}
        />

        <GuardStation
          attested={attested}
          changedCells={changedCells}
          changed={changed}
          phase={phase}
          matches={matches}
          closed={closed}
          arrived={arrived}
        />

        <Connector
          show={phase === "settled"}
          progress={phase === "settled" ? 1 : 0}
          bounce={false}
          tone="bonded"
          still={still}
        />

        {/*
          The caption is phase-derived, not outcome-derived.

          An earlier version read `matches ? "The money moves" : "Never reached"`, which spoiled the
          result the moment the switch was flipped -- the end of the journey announced the verdict
          before the call had left the skill. It now stays neutral until the run resolves.
        */}
        <Station
          label="Settlement"
          caption={
            phase === "settled"
              ? "The money moved"
              : phase === "refused"
                ? "Never reached"
                : "Where the money would go"
          }
          tone={phase === "settled" ? "bonded" : "neutral"}
          active={phase === "settled"}
        >
          <span
            className={cx(
              "hash text-label",
              phase === "settled" ? "text-bonded-ink" : "text-faint",
            )}
          >
            {phase === "settled" ? "SkillExecuted" : "\u2014"}
          </span>
        </Station>
      </div>
    </div>
  );
}

/** What each phase means, in words, for the live region. */
const PHASE_SPEECH: Record<Phase, (ctx: { matches: boolean; changed: number }) => string> = {
  idle: () => "A call is waiting at the skill.",
  travelling: () => "The call is travelling to the guard.",
  checking: () => "The guard is comparing the hash it was handed against the approved hash.",
  settled: () =>
    "The hashes match. The gate opened, the call settled, and SkillExecuted was emitted.",
  refused: ({ changed }) =>
    `The hashes disagree in ${changed} of 64 positions. The gate closed and the call was refused with NOT_PINNED. The money did not move.`,
};

/** A labelled box at one end of the journey. */
function Station({
  label,
  caption,
  children,
  tone,
  active,
}: {
  label: string;
  caption: string;
  children: React.ReactNode;
  tone: "neutral" | "bonded";
  active: boolean;
}) {
  return (
    <motion.div
      animate={{ opacity: active ? 1 : 0.55 }}
      transition={{ duration: 0.3 }}
      className={cx(
        "flex flex-col justify-center gap-1 rounded-2xl px-4 py-4 text-center",
        tone === "bonded"
          ? "pop bg-bonded-tint [--line:var(--bonded)] [--pop:var(--bonded-shade)]"
          : "chunk bg-raise",
      )}
    >
      <p className={cx("shout text-label", tone === "bonded" ? "text-bonded-ink" : "text-faint")}>
        {label}
      </p>
      <p className="text-xs leading-snug font-bold text-text">{caption}</p>
      {children}
    </motion.div>
  );
}

/**
 * A leg of the journey, with the call token riding along it.
 *
 * The whole connector is rotated a quarter turn below `lg`, rather than having two code paths for
 * horizontal and vertical. Rotating the container means the token's `left` animation becomes downward
 * movement for free, so the stacked layout still reads as a path travelled rather than three cards
 * with dividers. Only the token's own label is counter-rotated, so the word stays upright.
 *
 * The token is a labelled chip rather than a dot, because a bare circle sliding along a line does not
 * say what is moving.
 */
function Connector({
  show,
  progress,
  bounce,
  tone,
  still,
}: {
  show: boolean;
  progress: number;
  bounce: boolean;
  tone: "pinned" | "bonded";
  still: boolean;
}) {
  return (
    <div className="grid place-items-center">
      <div className="relative grid size-14 rotate-90 place-items-center lg:h-8 lg:w-24 lg:rotate-0">
        <div className="absolute h-1.5 w-full rounded-pill bg-raise-strong" />

        {still ? null : (
          <motion.div
            className="absolute h-1.5 w-full rounded-pill opacity-60"
            style={{
              background: `repeating-linear-gradient(90deg, var(--${tone}) 0 8px, transparent 8px 20px)`,
            }}
            animate={{ backgroundPositionX: ["0px", "20px"] }}
            transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
          />
        )}

        <AnimatePresence>
          {show ? (
            <motion.div
              className="absolute"
              initial={{ left: "0%", opacity: 0 }}
              animate={{ left: `${progress * 100}%`, opacity: 1, x: "-50%" }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={
                still
                  ? { duration: 0 }
                  : bounce
                    ? { type: "spring", stiffness: 240, damping: 11 }
                    : { duration: 0.95, ease: [0.22, 1, 0.36, 1] }
              }
            >
              <span
                className={cx(
                  "shout grid -rotate-90 rounded-lg border border-[var(--on-face)] px-2 py-1 text-label text-on-face lg:rotate-0",
                  tone === "pinned" ? "bg-pinned" : "bg-bonded",
                )}
              >
                call
              </span>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

/**
 * The guard: the checkpoint where the comparison happens, with the gate on its exit.
 *
 * This is the box the whole panel is about, so it is the widest of the three and holds the actual
 * evidence. The previous design put the two fingerprints in a separate row underneath, which left
 * the guard as an unexplained sliver on a rail and the comparison as an unexplained pair of
 * thumbnails, with nothing connecting them.
 */
function GuardStation({
  attested,
  changedCells,
  changed,
  phase,
  matches,
  closed,
  arrived,
}: {
  attested: string;
  changedCells: readonly number[];
  changed: number;
  phase: Phase;
  matches: boolean;
  closed: boolean;
  arrived: boolean;
}) {
  const resolved = phase === "settled" || phase === "refused";

  return (
    <div
      className={cx(
        "pop relative overflow-hidden rounded-2xl p-4",
        resolved
          ? matches
            ? "bg-bonded-tint [--line:var(--bonded)] [--pop:var(--bonded-shade)]"
            : "bg-revoked-tint [--line:var(--revoked)] [--pop:var(--revoked-shade)]"
          : "bg-raise",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="shout text-label text-faint">The guard</p>
        {/* The gate itself, as two leaves that meet. Small but unmistakably a barrier. */}
        <GateLeaves closed={closed} settled={phase === "settled"} />
      </div>

      <div className="mt-3 space-y-2">
        <Row
          caption="the code you approved"
          hash={APPROVED_HASH}
          tone="bonded"
          changed={[]}
          dim={false}
        />
        <Row
          caption="the code that is asking"
          hash={attested}
          tone={matches ? "bonded" : "revoked"}
          changed={changedCells}
          dim={!arrived}
        />
      </div>

      {/* The result of the comparison, stated as a sentence fragment rather than left implied. */}
      <div className="mt-3 flex min-h-8 items-center">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={resolved ? (matches ? "match" : "differ") : "waiting"}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.24 }}
          >
            {!resolved ? (
              <span className="shout text-label text-faint">
                {phase === "checking" ? "comparing\u2026" : "waiting for a call"}
              </span>
            ) : matches ? (
              <Pill tone="bonded">identical &middot; all 64 positions</Pill>
            ) : (
              <Pill tone="revoked">{changed} of 64 positions differ</Pill>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/**
 * Two leaves that close across the guard's exit.
 *
 * The old gate was a 2.5px bar scaled to 20% height when open, which read as a stray tick mark. Two
 * thick leaves that visibly travel toward each other and meet is the smallest thing that still reads
 * as a gate, and the colour change is a reinforcement rather than the only signal -- which matters
 * for anyone who cannot separate the green from the red.
 */
function GateLeaves({ closed, settled }: { closed: boolean; settled: boolean }) {
  return (
    <span
      aria-hidden
      className="chunk relative grid h-7 w-12 place-items-center overflow-hidden rounded-md bg-panel"
    >
      <motion.span
        className="absolute top-0 left-0 h-full w-1/2 border-r border-[var(--on-face)]"
        animate={{
          x: closed ? "0%" : "-88%",
          backgroundColor: closed ? "var(--revoked)" : "var(--bonded)",
        }}
        transition={SPRING_FIRM}
      />
      <motion.span
        className="absolute top-0 right-0 h-full w-1/2 border-l border-[var(--on-face)]"
        animate={{
          x: closed ? "0%" : "88%",
          backgroundColor: closed ? "var(--revoked)" : "var(--bonded)",
        }}
        transition={SPRING_FIRM}
      />
      {settled ? (
        <motion.span
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={SPRING_FIRM}
          className="relative text-label font-extrabold text-bonded-ink"
        >
          &rarr;
        </motion.span>
      ) : null}
    </span>
  );
}

/** One side of the comparison: a fingerprint, a caption, and the hash it came from. */
function Row({
  caption,
  hash,
  tone,
  changed,
  dim,
}: {
  caption: string;
  hash: string;
  tone: "bonded" | "revoked";
  changed: readonly number[];
  dim: boolean;
}) {
  return (
    <motion.div
      animate={{ opacity: dim ? 0.3 : 1 }}
      transition={{ duration: 0.3 }}
      className="flex items-center gap-3"
    >
      <div
        className={cx(
          "chunk shrink-0 rounded-lg bg-panel p-1.5",
          tone === "bonded" ? "[--line:var(--bonded)]" : "[--line:var(--revoked)]",
        )}
      >
        <HashFingerprint hash={hash} tone={tone} px={44} changed={changed} />
      </div>
      <div className="min-w-0">
        <p className="text-label leading-snug font-bold text-text">{caption}</p>
        <p
          className={cx(
            "hash text-label",
            tone === "bonded" ? "text-bonded-ink" : "text-revoked-ink",
          )}
        >
          {shortHash(hash, 10, 6)}
        </p>
      </div>
    </motion.div>
  );
}

/* --------------------------------------------------------------------- verdict */

/**
 * The outcome, delivered by Guard.
 *
 * Duolingo's graded-answer bar, with the parts doing the same jobs: a character reacting, a heavy
 * verdict line, the explanation underneath, and one obvious button to go again. The celebratory
 * burst fires only on a settle, and the panel shakes only on a refusal, so the two outcomes are
 * distinguishable without reading a word or seeing a colour.
 *
 * Under reduced motion both the burst and the shake are dropped by their own components, and the
 * copy plus Guard's expression still carry the whole verdict.
 */
function Verdict({
  phase,
  matches,
  changed,
  onReplay,
  run,
}: {
  phase: Phase;
  matches: boolean;
  changed: number;
  onReplay: () => void;
  run: number;
}) {
  const resolved = phase === "settled" || phase === "refused";

  const body = (
    <div
      className={cx(
        "pop relative rounded-2xl p-5",
        phase === "settled"
          ? "bg-bonded-tint [--line:var(--bonded)] [--pop:var(--bonded-shade)]"
          : phase === "refused"
            ? "bg-revoked-tint [--line:var(--revoked)] [--pop:var(--revoked-shade)]"
            : "bg-raise",
      )}
    >
      {phase === "settled" ? <Burst trigger={run} tone="var(--bonded)" /> : null}

      {/*
        The mascot stood here, at 72px, reacting to the phase.

        The copy below was always doing the work: "Settled" against "Refused", in the hue of the outcome, with
        a paragraph explaining which hash won. A face beside it was a second rendering of the same verdict, and
        of the two the words are the one a reader can check.
      */}
      <div className="relative">
        <div className="min-h-[6rem]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={phase === "settled" ? "settled" : phase === "refused" ? "refused" : "pending"}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-2"
            >
              {!resolved ? (
                <>
                  <p className="font-display text-lg leading-none font-extrabold text-pinned-ink">
                    Checking&hellip;
                  </p>
                  <p className="text-sm leading-relaxed font-semibold text-muted">
                    The guard reads the hash pinned in the registry and compares it with the hash the
                    call handed over. It never looks at the code itself, so there is nothing to
                    argue with.
                  </p>
                </>
              ) : matches ? (
                <>
                  <p className="font-display text-2xl leading-none font-extrabold text-bonded-ink">
                    Settled
                  </p>
                  <p className="text-sm leading-relaxed font-semibold text-muted">
                    Both hashes are the same, so this is the exact code you approved. The gate opened,
                    the money moved, and{" "}
                    <code className="hash text-xs font-bold text-text">SkillExecuted</code> went on
                    chain as the receipt.
                  </p>
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-display text-2xl leading-none font-extrabold text-revoked-ink">
                      Refused
                    </p>
                    <Pill tone="revoked">NOT_PINNED</Pill>
                  </div>
                  <p className="text-sm leading-relaxed font-semibold text-muted">
                    The version number never changed, but {changed} of the 64 positions in the hash
                    did &mdash; so this is not the code you approved. The whole transaction reverted
                    at the gate. <strong className="font-extrabold text-text">The money never
                    moved.</strong>
                  </p>
                </>
              )}

              {resolved ? (
                <Button
                  tone={matches ? "bonded" : "revoked"}
                  size="sm"
                  onClick={onReplay}
                  className="mt-1"
                >
                  Run it again
                </Button>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );

  // Only a refusal shakes. Keyed on the run counter so flipping back and forth replays it.
  return phase === "refused" ? <Shake trigger={run}>{body}</Shake> : body;
}
