"use client";

/**
 * The header Guard delivers, with the four measures beside it.
 *
 * Structurally this is Duolingo's home header: a character, a line of encouragement, and a row of
 * counters. The counters are the part that had to be earned rather than copied -- see lib/health.ts
 * for what was cut and why. Each one here is a ratio over data the registry emits, and each carries
 * its own raw counts underneath so a reader can see what the percentage is a percentage of. A ring
 * showing 80% with no denominator is a decoration; one labelled "4 of 5" is a fact.
 */

import { healthOf, verdictCopy } from "@/lib/health";
import type { Snapshot } from "@/lib/model";

import { GuardSays } from "./guard";
import { Pop, RevealItem, RevealGroup } from "./motion";
import { Meter, Ring, cx } from "./ui";

export function Scoreboard({ snapshot }: { snapshot: Snapshot }) {
  const health = healthOf(snapshot);

  /*
   * Guard's mood is the verdict, with one substitution.
   *
   * `blocked` in the health model means a publisher equivocated, which is the worst state the system
   * reports; `alarmed` means drift. Both map onto the mascot moods of the same name, and `watching`
   * covers an empty registry, where there is genuinely nothing to say.
   */
  const mood = health.verdict;

  return (
    <div className="space-y-6">
      <Pop>
        <GuardSays mood={mood} size={128} label={GUARD_LABEL[mood]}>
          <span className="font-display block text-lg leading-tight font-extrabold sm:text-xl">
            {HEADLINE[mood]}
          </span>
          <span className="mt-1.5 block text-sm leading-relaxed font-semibold opacity-90">
            {verdictCopy(health)}
          </span>
        </GuardSays>
      </Pop>

      <RevealGroup className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <RevealItem>
          <Gauge
            label="Integrity"
            hint={
              health.approvedCount === 0
                ? "Nothing approved yet"
                : `${health.approvedCount - health.driftedCount} of ${health.approvedCount} approved skills still match`
            }
            tone={health.driftedCount > 0 ? "attention" : "bonded"}
          >
            <Ring
              value={health.integrity}
              tone={health.driftedCount > 0 ? "attention" : "bonded"}
              size={104}
            >
              <span className="font-display text-2xl font-extrabold text-text">
                {Math.round(health.integrity * 100)}
                <span className="text-sm">%</span>
              </span>
            </Ring>
          </Gauge>
        </RevealItem>

        <RevealItem>
          <Gauge
            label="Bond coverage"
            hint={
              health.liveCount === 0
                ? "No live pins"
                : `${health.bondedCount} of ${health.liveCount} live pins have collateral at stake`
            }
            tone="pinned"
          >
            <Ring value={health.bondCoverage} tone="pinned" size={104}>
              <span className="font-display text-2xl font-extrabold text-text">
                {Math.round(health.bondCoverage * 100)}
                <span className="text-sm">%</span>
              </span>
            </Ring>
          </Gauge>
        </RevealItem>

        <RevealItem>
          <Counter
            label="Clean publishers"
            value={health.cleanPublishers}
            of={health.publisherCount}
            hint="No slash on record"
            tone="bonded"
          />
        </RevealItem>

        <RevealItem>
          <Counter
            label="Equivocations"
            value={health.equivocations}
            of={health.publisherCount}
            hint="Shipped conflicting bytes under one version"
            tone={health.equivocations > 0 ? "equivocated" : "neutral"}
          />
        </RevealItem>
      </RevealGroup>
    </div>
  );
}

const HEADLINE: Record<ReturnType<typeof healthOf>["verdict"], string> = {
  settled: "Everything matches.",
  alarmed: "Something changed underneath you.",
  blocked: "A publisher contradicted themselves.",
  watching: "Nothing approved yet.",
};

/*
 * What the mascot's image role announces here.
 *
 * The moods are named after expressions, and one of them is reused across two different facts: the
 * stern `blocked` face means "a call was refused" on the gate and "a publisher equivocated" here.
 * The default label describes the former, so this states the latter. Kept short because the bubble
 * beside it carries the full explanation and a screen reader should not hear it twice.
 */
const GUARD_LABEL: Record<ReturnType<typeof healthOf>["verdict"], string> = {
  settled: "Guard looks settled.",
  alarmed: "Guard looks alarmed.",
  blocked: "Guard looks stern.",
  watching: "Guard is watching.",
};

/** A ring in a tile, with the label above and the denominator below. */
function Gauge({
  label,
  hint,
  tone,
  children,
}: {
  label: string;
  hint: string;
  tone: "bonded" | "pinned" | "attention";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cx(
        "pop flex h-full flex-col items-center gap-3 rounded-2xl bg-panel p-5 text-center",
        TILE_TONE[tone],
      )}
    >
      <p className="shout text-label text-faint">{label}</p>
      {children}
      <p className="text-xs leading-snug font-semibold text-muted">{hint}</p>
    </div>
  );
}

/**
 * A plain count, for the two measures that are not ratios.
 *
 * A ring at 0 of 0 looks broken and a ring showing "2 equivocations" would imply 2 out of some
 * total worth completing. Counts get a meter instead, which reads as a proportion without implying
 * a goal.
 */
function Counter({
  label,
  value,
  of,
  hint,
  tone,
}: {
  label: string;
  value: number;
  of: number;
  hint: string;
  tone: "bonded" | "equivocated" | "neutral";
}) {
  const meterTone = tone === "neutral" ? "pinned" : tone;

  return (
    <div
      className={cx(
        "pop flex h-full flex-col justify-between gap-4 rounded-2xl bg-panel p-5",
        tone === "neutral" ? "" : TILE_TONE[tone],
      )}
    >
      <div>
        <p className="shout text-label text-faint">{label}</p>
        <p className="mt-2 flex items-baseline gap-1.5">
          <span
            className={cx(
              "font-display text-4xl leading-none font-extrabold",
              tone === "equivocated" ? "text-equivocated-ink" : "text-text",
            )}
          >
            {value}
          </span>
          <span className="text-sm font-bold text-faint">of {of}</span>
        </p>
      </div>

      <div className="space-y-2">
        <Meter value={of === 0 ? 0 : value / of} tone={meterTone} height="sm" />
        <p className="text-xs leading-snug font-semibold text-muted">{hint}</p>
      </div>
    </div>
  );
}

const TILE_TONE: Record<string, string> = {
  bonded: "[--line:var(--bonded)] [--pop:var(--bonded-shade)]",
  pinned: "[--line:var(--pinned)] [--pop:var(--pinned-shade)]",
  attention: "[--line:var(--attention)] [--pop:var(--attention-shade)]",
  equivocated: "[--line:var(--equivocated)] [--pop:var(--equivocated-shade)]",
};
