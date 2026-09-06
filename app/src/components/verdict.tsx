"use client";

/**
 * The verdict, and the queue under it. This replaces the scoreboard.
 *
 * ## What was wrong with what it replaces
 *
 * The scoreboard was Guard, a headline, and four ratios in four identical tiles: integrity, bond coverage,
 * clean publishers, equivocations. Every tile the same size, the same border, the same weight. That flat grid
 * is the most common failure in this class of product, and it fails in a specific way: a reader can take in
 * all four numbers and still not know whether they are supposed to do anything. The page reported state and
 * did not rank it.
 *
 * Worse, it was not the first thing on the page and it was not the page's heading. The `h1` and the largest
 * number on the dashboard was "Live pins" — a registry-wide count. The biggest thing on the screen answered
 * "how big is this registry", when the question a returning reader arrives with is "is anything wrong with
 * mine".
 *
 * ## What this does instead
 *
 * One sentence, as the `h1`, stating whether anything needs them. Then the primary action, if there is one.
 * Then the queue itself, item by item, each naming what changed and where to decide it. Quiet at rest and
 * loud on demand, which is the whole prescription for a screen someone reads under pressure.
 *
 * The ratios did not deserve deleting, only demoting: they are real measures over registry data and they are
 * the answer to a second question, "how am I doing", which is worth a section that is not the first one. They
 * are in `Position` below, as three rather than four — equivocations left because they are now a queue item
 * with an action attached, and a count of them in a tile was a fact the reader could do nothing with.
 */

import { healthOf, verdictCopy } from "@/lib/health";
import type { Snapshot } from "@/lib/model";
import { decisionsFor, queueHeadline } from "@/lib/queue";
import type { Decision } from "@/lib/queue";
import { formatCount } from "@/lib/format";

import { GuardSays } from "./guard";
import { Pop, RevealGroup, RevealItem } from "./motion";
import { Button, Empty, Pill, Ring, Section, cx } from "./ui";

/**
 * The fold: is anything wrong, and what do I do about it.
 *
 * Carries the route's `h1`, and the heading is the answer rather than the page's name. A dashboard whose
 * heading is "Dashboard" has spent its most prominent line of type saying something the navigation already
 * said.
 */
export function Verdict({ snapshot }: { snapshot: Snapshot }) {
  const health = healthOf(snapshot);
  const decisions = decisionsFor(snapshot);
  const lead = decisions[0];

  /*
   * Guard's mood follows the queue, not the health verdict, in the one case they disagree.
   *
   * `healthOf` reports `watching` for an empty registry, which is right for a ratio nobody can compute. But
   * if there is nothing approved *and* nothing to decide, the honest face is settled rather than watchful:
   * there is no problem being monitored, there is simply nothing here yet, and the sentence below says so.
   */
  const mood = decisions.length === 0 ? (health.approvedCount === 0 ? "watching" : "settled") : health.verdict;

  return (
    <div className="space-y-6">
      <Pop>
        <GuardSays mood={mood} size={128} label={GUARD_LABEL[mood]}>
          <p className="shout text-label opacity-70">Your agent</p>
          {/*
            The h1. It changes with the data, and that is the point.

            Sized to match every other route's h1 rather than made bigger, because the level is a statement
            about structure and the prominence comes from being first and being the only sentence there.
          */}
          <h1 className="font-display mt-1 text-2xl leading-tight font-extrabold sm:text-3xl">
            {queueHeadline(decisions)}
          </h1>
          <p className="mt-2 text-sm leading-relaxed font-semibold opacity-90">
            {lead === undefined ? verdictCopy(health) : lead.detail}
          </p>

          {/*
            One action, and only when there is one to take.

            The highest-drop moment in this category is the silence right after a wallet connects: the
            interface loads, nothing tells the reader what to do, and they leave. A button that always
            appears would have to point somewhere when nothing is wrong, and "go and look at something" is
            the shape of a link nobody follows.
          */}
          {lead === undefined ? null : (
            <span className="mt-4 block">
              <Button href={lead.href} tone={lead.tone} size="sm">
                {lead.kind === "equivocation" ? "Open publishers" : "Review the change"}
              </Button>
            </span>
          )}
        </GuardSays>
      </Pop>

      <Queue decisions={decisions} />
    </div>
  );
}

/**
 * The queue itself.
 *
 * Rendered even when empty, because the empty state is the one a reader sees most and it is the one that has
 * to be trustworthy. A blank region reads as broken; a stated "nothing pending, and here is what would
 * appear" reads as quiet. Security readers spend most of their time in the calm state, so the calm state is
 * not the afterthought.
 */
function Queue({ decisions }: { decisions: readonly Decision[] }) {
  if (decisions.length === 0) {
    return (
      <Empty title="Nothing pending" mood="settled">
        This is where a skill that no longer matches the bytes you approved would appear, alongside any
        publisher caught shipping conflicting code under one version string. Both are read from the registry
        rather than reported by anyone, so an empty list here is a reading and not a reassurance.
      </Empty>
    );
  }

  return (
    <RevealGroup className="space-y-3">
      {decisions.map((decision) => (
        <RevealItem key={decision.id}>
          {/*
            A link, not a card with a button in it.

            The whole row is the target because the whole row is one decision, and a 40px button inside a
            120px card is a smaller thing to hit for no gain. The hue is on the left edge rather than
            filling the row: colour marks severity here, and a filled amber row beside a filled red row
            turns a queue into a warning banner stack.
          */}
          <a
            href={decision.href}
            className={cx(
              "pop group block rounded-xl bg-panel p-5 transition-colors hover:bg-raise",
              EDGE[decision.tone],
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="font-display min-w-0 text-lg leading-tight font-extrabold text-text">
                {decision.title}
              </p>
              <Pill tone={decision.tone}>{KIND_LABEL[decision.kind]}</Pill>
            </div>
            <p className="measure mt-2 text-sm leading-relaxed font-semibold text-muted">{decision.detail}</p>
          </a>
        </RevealItem>
      ))}
    </RevealGroup>
  );
}

/*
 * A left edge in the severity hue, drawn with a border rather than a filled row.
 *
 * `border-l-4` is the one place a thicker rule survives the hairline rule, because it is not a border around
 * a surface — it is a bar. Everything else in the app uses 1px, and the design-system test forbids the old
 * 2px box borders by name.
 */
const EDGE: Record<Decision["tone"], string> = {
  equivocated: "border-l-4 border-l-equivocated",
  attention: "border-l-4 border-l-attention",
  pinned: "border-l-4 border-l-pinned",
};

/** The word beside each row, so severity is never carried by colour alone. */
const KIND_LABEL: Record<Decision["kind"], string> = {
  equivocation: "provable lie",
  widened: "can do more",
  narrowed: "hash differs",
};

/*
 * What the mascot's image role announces.
 *
 * The moods are named after expressions, and one is reused across two facts: the stern `blocked` face means
 * "a call was refused" on the gate and "a publisher equivocated" here. The default label describes the
 * former, so this states the latter. Short, because the sentence beside it carries the explanation and a
 * screen reader should not hear it twice.
 */
const GUARD_LABEL: Record<ReturnType<typeof healthOf>["verdict"], string> = {
  settled: "Guard looks settled.",
  alarmed: "Guard looks alarmed.",
  blocked: "Guard looks stern.",
  watching: "Guard is watching.",
};

/**
 * How this account is doing, as three measures rather than four.
 *
 * Each is a ratio over data the registry emits, and each carries its own denominator underneath, because a
 * ring at 80% with no denominator is a decoration and one labelled "4 of 5" is a fact. See lib/health.ts for
 * the measures that were cut for being unfalsifiable.
 *
 * Demoted below the queue on purpose. These answer "how am I doing", which is a real question and not the
 * first one.
 */
export function Position({ snapshot }: { snapshot: Snapshot }) {
  const health = healthOf(snapshot);
  const drifting = health.driftedCount > 0;

  return (
    <Section
      eyebrow="Your position"
      title="What is holding"
      description="Every figure here is a count over registry data with its denominator beside it, so a percentage is always checkable against the number it came from."
    >
      <RevealGroup className="grid gap-4 sm:grid-cols-3">
        <RevealItem>
          <Gauge
            label="Integrity"
            hint={
              health.approvedCount === 0
                ? "Nothing approved yet"
                : `${health.approvedCount - health.driftedCount} of ${health.approvedCount} approved skills still match`
            }
            tone={drifting ? "attention" : "bonded"}
          >
            <Ring value={health.integrity} tone={drifting ? "attention" : "bonded"} size={104}>
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
          {/*
            A count, not a ring.

            There is no denominator for "how many calls checked a pin" -- the total would be every call ever
            made anywhere, which is not a goal anyone is completing. A ring implies a target; a number does
            not, and drawing one at 0 of 0 looks broken.
          */}
          <Gauge label="Guarded executions" hint="Calls that checked a pin before they settled" tone="bonded">
            <p className="font-display text-4xl leading-none font-extrabold tabular-nums text-text">
              {formatCount(snapshot.totals.executions)}
            </p>
          </Gauge>
        </RevealItem>
      </RevealGroup>
    </Section>
  );
}

/** One shape for all three, so a ring and a number do not read as two kinds of tile. */
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
        "pop flex h-full flex-col items-center justify-center gap-3 rounded-xl bg-panel p-5 text-center",
        TILE_TONE[tone],
      )}
    >
      <p className="shout text-label text-faint">{label}</p>
      {children}
      <p className="text-xs leading-snug font-semibold text-muted">{hint}</p>
    </div>
  );
}

const TILE_TONE: Record<string, string> = {
  bonded: "[--line:var(--bonded)] [--pop:var(--bonded-shade)]",
  pinned: "[--line:var(--pinned)] [--pop:var(--pinned-shade)]",
  attention: "[--line:var(--attention)] [--pop:var(--attention-shade)]",
};
