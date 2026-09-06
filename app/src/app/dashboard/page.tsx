"use client";

/**
 * The dashboard.
 *
 * ## The order, and why it changed
 *
 * It used to be: quickstart, scoreboard, ledger, then two lists. The `h1` and the largest number on the page
 * was "Live pins" — a registry-wide count — and above it sat four equal-weight ratio tiles. So the most
 * prominent thing on the screen answered "how big is this registry", and the four tiles reported state
 * without ranking it. A reader could take all of it in and still not know whether they were supposed to do
 * anything.
 *
 * The order now runs from decision to context:
 *
 *   verdict      is anything wrong, as the h1, with the one action if there is one
 *   queue        each thing that needs a decision, or a stated empty state
 *   position     three ratios: how am I doing
 *   quickstart   what is left to set up, and only while something is
 *   registry     the registry's totals, compact, as context rather than a headline
 *   activity     what has happened, newest first, with recent pins beside it
 *
 * Two findings drove it. The highest drop-off in this category is not the wallet connect — it is the silence
 * immediately after, when the interface has loaded and nothing tells the reader what to do. And in security
 * tooling specifically, the resting state should be quiet and only what needs attention should be loud; a
 * flat grid where every tile shouts at the same volume is the standard failure.
 *
 * The mechanism demo, the boundary panel and the pitch all stayed on the landing page. A dashboard that
 * re-explains the product is a dashboard nobody scrolls.
 */

import Link from "next/link";

import { Activity } from "@/components/activity";
import { useCertainty, useSnapshot } from "@/components/data";
import { FingerprintMark } from "@/components/fingerprint";
import { Reveal, RevealGroup, RevealItem } from "@/components/motion";
import { Quickstart } from "@/components/quickstart";
import { Position, Verdict } from "@/components/verdict";
import { Button, Card, Empty, Section, Skeleton, StatePill, cx } from "@/components/ui";
import { formatBond, formatCount, timeAgo } from "@/lib/format";
import type { BondPricing, DataSource, Totals } from "@/lib/model";
import { displayName } from "@/lib/untrusted";

export default function DashboardPage() {
  const { snapshot } = useSnapshot();
  const { totals, pricing, pins } = snapshot;

  return (
    <div className="space-y-12">
      {/*
        First, and it carries the h1.

        Everything above this used to be the quickstart, which meant a returning reader with an unfinished
        checklist met a setup panel before the answer to "is anything wrong". Setup is real but it is not
        urgent, and it has moved below the two sections that are.
      */}
      <Verdict snapshot={snapshot} />

      <Position snapshot={snapshot} />

      {/*
        Only while it has something to say. It removes itself once dismissed or finished, so the steady state
        of this page has no onboarding on it at all.
      */}
      <Quickstart />

      <Registry totals={totals} pricing={pricing} source={snapshot.source} />

      {/* Activity carries more weight than the pin list beside it, so it gets the wider column. */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] 2xl:gap-8">
        {/*
          `Activity` owns the "new since you last looked" count as well as the list.

          Deliberately not lifted into this section's eyebrow, which would read better: the count comes from a
          hook that also *records* the visit, and calling it twice would mean the second caller captured a
          baseline the first had already overwritten. One hook, one component, no delta that silently reads
          zero.
        */}
        <Section
          eyebrow="Newest first"
          title="Activity"
          description="Executions the guard checked, and the calls it refused, in one record."
        >
          <Activity snapshot={snapshot} />
        </Section>

        <Section
          eyebrow="Most recent"
          title="Pins"
          aside={
            <Button href="/pins" tone="pinned" variant="quiet" size="sm">
              All pins
            </Button>
          }
        >
          {/*
            An empty registry rendered the "Pins" heading and the "All pins" button above an empty div.

            Every other list in the app has a real `Empty` state; this one had no length guard at all, so a
            fresh deployment showed a section that looked broken rather than one that looked new.
          */}
          {pins.length === 0 ? (
            <Empty title="No pins yet">
              Nothing has been published to this registry. The first publish locks a bond priced by how much
              the skill may do, so an empty registry is the normal starting state rather than a fault.
            </Empty>
          ) : (
            <RevealGroup className="space-y-3">
              {pins.slice(0, 5).map((pin) => (
                <RevealItem key={pin.pinId}>
                  <Link href={{ pathname: "/pins", query: { pin: pin.pinId } }} className="block">
                    <Card interactive className="p-5">
                      <div className="flex flex-wrap items-center gap-4">
                        {/* The pin's face, from its own bytes. Recognisable across pages. */}
                        <div className="chunk rounded-lg bg-raise p-2">
                          <FingerprintMark hash={pin.skillHash} px={30} />
                        </div>

                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="font-display text-lg leading-tight font-extrabold break-words text-text">
                            {displayName(pin.skillName)}
                            {pin.skillVersion === undefined ? null : (
                              <span className="ml-2 text-sm font-bold text-faint">
                                {displayName(pin.skillVersion, "")}
                              </span>
                            )}
                          </p>
                          <p className="text-xs font-semibold text-faint">
                            {pin.capabilities.length}{" "}
                            {pin.capabilities.length === 1 ? "capability" : "capabilities"}
                            {pin.capabilities.some((c) => c.highRisk)
                              ? ` \u00b7 ${pin.capabilities.filter((c) => c.highRisk).length} high risk`
                              : ""}{" "}
                            &middot; {timeAgo(pin.publishedAt)}
                          </p>
                        </div>

                        <StatePill state={pin.state} />
                      </div>
                    </Card>
                  </Link>
                </RevealItem>
              ))}
            </RevealGroup>
          )}
        </Section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ registry */

/**
 * The registry's totals, as a compact strip.
 *
 * ## Why this shrank
 *
 * It was a ledger: "Live pins" at `text-6xl` beside three rule-separated rows, and it carried the page's
 * `h1`. One figure set enormous is the right treatment for the number a page is *about*, and this page is not
 * about the size of the registry — it is about whether this account is in trouble. A reader's own drift
 * warning cannot compete with a 60px number for attention, and it should not have to.
 *
 * So the same four facts, at roughly a third of the density, below the sections that concern the reader
 * directly. Denser than what it replaced rather than more spacious, deliberately: dense is correct for a
 * low-value zone, because it takes less of the page to say the same thing.
 *
 * ## Why the heading still changes with the data
 *
 * Unchanged from the ledger, and for a reason worth keeping. This was once titled "What is on chain right
 * now" unconditionally, with the sample/live distinction living only in a thin pill at the top of the page. A
 * reviewer read the figures as claims about a deployment and flagged, correctly, that a judge who opened a
 * block explorer and found nothing would conclude the project was lying. A heading that says "on chain right
 * now" outranks a 10px label thirty centimetres above it, so the heading itself has to state which it is.
 */
function Registry({
  totals,
  pricing,
  source,
}: {
  totals: Totals;
  pricing: BondPricing;
  source: DataSource;
}) {
  const bondWhole = Number(totals.bondLocked / 10n ** BigInt(pricing.bondAssetDecimals));

  /*
   * Three states, not `source.kind === "chain"`.
   *
   * While the read is in flight the seeded snapshot is a fixture, so the old expression titled this section
   * "What this looks like with data in it" and captioned the figures "sample" before it had looked at
   * anything. See `useCertainty` in components/data.tsx.
   */
  const certainty = useCertainty();
  const live = certainty === "chain";
  const reading = certainty === "reading";

  const cells = [
    {
      label: "Live pins",
      value: formatCount(totals.livePins),
      hint: `of ${totals.pins} ever published`,
      tone: "text-bonded-ink",
    },
    {
      label: "Bond locked",
      value: `${formatCount(bondWhole)} ${pricing.bondAssetSymbol}`,
      hint: "not withdrawable while the claims stand",
      tone: "text-pinned-ink",
    },
    {
      label: "Publishers",
      value: formatCount(totals.publishers),
      hint: "addresses with at least one pin",
      tone: "text-text",
    },
    {
      label: "Bond slashed",
      value: formatBond(totals.slashed, pricing.bondAssetDecimals),
      hint: "taken from publishers caught contradicting themselves",
      tone: totals.slashed > 0n ? "text-revoked-ink" : "text-faint",
    },
  ];

  return (
    <Section
      eyebrow={live ? "Registry" : reading ? "Registry \u00b7 reading" : "Registry \u00b7 sample"}
      title={
        live
          ? "What is on chain right now"
          : reading
            ? "Reading the registry"
            : "What this looks like with data in it"
      }
      description={
        live || reading ? undefined : (
          <>
            No registry address is configured, so these are worked examples, not readings. Every figure below
            is derived from the sample fixtures rather than a deployment &mdash; the slashed total, for
            instance, is the sum of the bonds on pins the fixtures mark as slashed. Point{" "}
            <code className="hash text-xs font-bold text-text">NEXT_PUBLIC_PIN_REGISTRY</code> at a deployment
            and the same components read it instead.
          </>
        )
      }
    >
      <Reveal>
        <div
          className="pop grid rounded-xl bg-panel sm:grid-cols-2 xl:grid-cols-4"
          aria-busy={reading ? "true" : undefined}
        >
          {cells.map((cell, index) => (
            <div
              key={cell.label}
              className={cx(
                "px-5 py-4",
                /*
                  Rules between cells rather than around them.

                  Four separate cards would make four facts look like four sections. One panel divided by
                  hairlines reads as one table, which is what it is -- and the borders are drawn per cell
                  because `divide-x` does not survive a grid wrapping to two columns.
                */
                index === 0 ? "" : "border-t border-line sm:border-t-0",
                index % 2 === 1 ? "sm:border-l sm:border-line" : "",
                index >= 2 ? "sm:border-t sm:border-line xl:border-t-0" : "",
                index >= 1 ? "xl:border-l xl:border-line" : "",
              )}
            >
              <p className="shout text-label text-faint">
                {cell.label}
                {live || reading ? null : <span className="text-attention-ink"> &middot; sample</span>}
              </p>
              {/*
                While reading, the figure waits instead of showing the fixture's with a "reading" caption
                beside it.

                The caption was the earlier fix and it was half of one: a cell labelled "· reading" was still
                printing a sample number, and a reader has no way to tell a placeholder number from a real one.
                The label above is a static truth about what this cell counts, so it stays; only the value is
                not yet a fact.

                Tabular figures are inherited from `html`, so restating them per cell would be noise.
              */}
              {reading ? (
                <Skeleton className="mt-1.5 h-6 w-20" />
              ) : (
                <p className={cx("font-display mt-1.5 text-2xl leading-none font-extrabold", cell.tone)}>
                  {cell.value}
                </p>
              )}
              <p className="mt-1.5 text-xs leading-snug font-semibold text-muted">{cell.hint}</p>
            </div>
          ))}
        </div>
      </Reveal>
    </Section>
  );
}
