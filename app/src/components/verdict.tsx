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

import { useCertainty } from "./data";
import { Pop, RevealGroup, RevealItem } from "./motion";
import { Button, Empty, Notice, Pill, Ring, Section, Skeleton, cx } from "./ui";

/**
 * The fold: is anything wrong, and what do I do about it.
 *
 * Carries the route's `h1`, and the heading is the answer rather than the page's name. A dashboard whose
 * heading is "Dashboard" has spent its most prominent line of type saying something the navigation already
 * said.
 */
export function Verdict({ snapshot }: { snapshot: Snapshot }) {
  const certainty = useCertainty();
  const health = healthOf(snapshot);
  const decisions = decisionsFor(snapshot);
  const lead = decisions[0];

  /*
   * While the read is in flight, this section says nothing rather than saying the fixture's answer.
   *
   * The bug it closes was real and it was mine. `decisionsFor` runs against whatever snapshot is mounted, and
   * the provider seeds a fixture so the page has a shape -- a fixture which contains a widening drift. So for
   * the duration of every read, the h1 on the dashboard read "2 things need your decision", about somebody
   * else's sample data, on the account owner's own account page. A false positive on a security tool is worse
   * than a slow one.
   *
   * Note this narrows on `certainty` and not on `source.kind`, which is exactly why `useCertainty` exists:
   * `source.kind` is still `sample` during the read, so keying off it would make this branch permanent on a
   * build with no registry configured -- where the sample figures are correct and labelled as such.
   */
  if (certainty === "reading") return <VerdictReading />;

  /*
   * The notice's hue follows the queue, not the health verdict, in the one case they disagree.
   *
   * `healthOf` reports `watching` for an empty registry, which is right for a ratio nobody can compute. But if
   * there is nothing approved *and* nothing to decide, the honest reading is settled rather than watchful:
   * there is no problem being monitored, there is simply nothing here yet, and the sentence below says so.
   */
  const state = decisions.length === 0 ? (health.approvedCount === 0 ? "watching" : "settled") : health.verdict;

  return (
    <div className="space-y-6">
      <Pop>
        <Notice tone={TONE[state]}>
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
        </Notice>
      </Pop>

      <Queue decisions={decisions} />
    </div>
  );
}

/**
 * The same section, while the registry is still being read.
 *
 * Guard is `watching` rather than `settled`, because "everything matches" is a claim and this state has not
 * checked anything yet. The h1 stays an h1 so the document outline does not change shape halfway through a
 * load, which would move a screen-reader user's landmark out from under them.
 *
 * `aria-busy` on the region and a live sentence, rather than a spinner. A screen reader gets told the page is
 * working and gets told again when it is not; a spinning glyph tells it nothing at all.
 */
function VerdictReading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Pop>
        <Notice tone="pinned">
          <p className="shout text-label opacity-70">Your agent</p>
          <h1 className="font-display mt-1 text-2xl leading-tight font-extrabold sm:text-3xl">
            Reading the registry.
          </h1>
          <p className="mt-2 text-sm leading-relaxed font-semibold opacity-90">
            Checking every approved skill against the bytes on chain. Nothing on this page is a claim about your
            account until that read lands.
          </p>
        </Notice>
      </Pop>

      {/*
        Two rows, matching the height of a queue row rather than an arbitrary bar.

        Two and not one because a single placeholder reads as "there is one thing", which is a number, and this
        state does not have one yet.
      */}
      <div className="space-y-3">
        {[0, 1].map((row) => (
          <div key={row} className="pop rounded-xl bg-panel p-5">
            <Skeleton className="h-5 w-2/5" />
            <Skeleton className="mt-3 h-3 w-4/5" />
            <Skeleton className="mt-2 h-3 w-3/5" />
          </div>
        ))}
      </div>
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
      <Empty title="Nothing pending">
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
 * The health verdict, mapped onto the semantic hues.
 *
 * This replaces a table of spoken labels for the mascot's expressions -- "Guard looks stern." and so on. Those
 * existed because a face is more general than a sentence and needed telling apart in the accessibility tree.
 * Nothing needs telling apart now: the notice contains the sentence, so the words that were once the mascot's
 * label are the words on screen.
 *
 * The hue is never the only signal here either. Every state's sentence says what it is, so this only decides
 * which tint carries it.
 */
const TONE: Record<ReturnType<typeof healthOf>["verdict"], "bonded" | "attention" | "revoked" | "pinned"> = {
  settled: "bonded",
  alarmed: "attention",
  blocked: "revoked",
  watching: "pinned",
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
  const certainty = useCertainty();
  const health = healthOf(snapshot);
  const drifting = health.driftedCount > 0;

  /*
   * Same rule as the verdict above: the labels are static truths, the figures are not yet facts.
   *
   * An 80% integrity ring drawn from a fixture is a specific, memorable, wrong number about the reader's own
   * account. The label "Integrity" is true whatever the reading turns out to be, so it stays.
   */
  if (certainty === "reading") return <PositionReading />;

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
            {/* No `tabular-nums` here: globals.css sets it on `html`, so every figure inherits it already. */}
            <p className="font-display text-4xl leading-none font-extrabold text-text">
              {formatCount(snapshot.totals.executions)}
            </p>
          </Gauge>
        </RevealItem>
      </RevealGroup>
    </Section>
  );
}

/** The three tiles with their labels and none of their numbers, while the read is in flight. */
function PositionReading() {
  return (
    <Section
      eyebrow="Your position"
      title="What is holding"
      description="Reading the registry now. These fill in from the chain rather than from a cached copy, so they arrive together or not at all."
    >
      <div className="grid gap-4 sm:grid-cols-3" aria-busy="true">
        {["Integrity", "Bond coverage", "Guarded executions"].map((label) => (
          <div
            key={label}
            className="pop flex h-full flex-col items-center justify-center gap-3 rounded-xl bg-panel p-5 text-center"
          >
            <p className="shout text-label text-faint">{label}</p>
            {/*
              104px square, because that is the diameter the `Ring` draws. A smaller placeholder would let the
              tile grow when the read lands, and a tile that changes height is the jump a skeleton exists to
              prevent.
            */}
            <Skeleton className="size-[104px] rounded-pill" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        ))}
      </div>
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
