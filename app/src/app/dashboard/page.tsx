"use client";

/**
 * The dashboard.
 *
 * Everything on this page answers a returning reader's question -- "is anything wrong, and what is the
 * state of things" -- which is a different question from the one the landing page answers. They shared a
 * route until the first-run flow was added, and the cost was that the reader who visits most often paid
 * for the pitch every time.
 *
 * The order is by how quickly a fact is needed rather than by how impressive it looks:
 *
 *   quickstart   what is left to set up, and only while something is
 *   scoreboard   is anything wrong, answered without reading
 *   ledger       the registry's totals
 *   lists        recent pins, and calls that were refused
 *
 * The mechanism demo, the boundary panel and the pitch all stayed on the landing page. A dashboard that
 * re-explains the product is a dashboard nobody scrolls.
 */

import Link from "next/link";

import { useSnapshot } from "@/components/data";
import { FingerprintDiff, FingerprintMark } from "@/components/fingerprint";
import { CountUp, Reveal, RevealGroup, RevealItem } from "@/components/motion";
import { Quickstart } from "@/components/quickstart";
import { Scoreboard } from "@/components/scoreboard";
import { Button, Card, Pill, Section, StatePill, cx } from "@/components/ui";
import { formatBond, formatCount, timeAgo } from "@/lib/format";
import type { DataSource } from "@/lib/model";
import { displayName } from "@/lib/untrusted";

export default function DashboardPage() {
  const { snapshot } = useSnapshot();
  const { totals, pricing, pins, blocked } = snapshot;

  return (
    <div className="space-y-12">
      {/*
        First, and only while it has something to say. It removes itself once dismissed or finished, so
        the steady state of this page has no onboarding on it at all.
      */}
      <Quickstart />

      {/*
        The state of the account, delivered by the mascot, before anything else.

        This is where Duolingo puts its streak and XP row, and the position is right for the same
        reason: a returning user's first question is "is anything wrong", and it should be answered
        above the fold without reading. Every figure in it is a ratio over registry data -- see
        lib/health.ts for the ones that were cut for being unfalsifiable.
      */}
      <Reveal>
        <Scoreboard snapshot={snapshot} />
      </Reveal>

      <Ledger totals={totals} pricing={pricing} source={snapshot.source} />

      {/* Two unequal columns: the pin list carries more weight than the refusal note beside it. */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] 2xl:gap-8">
        <Section
          eyebrow="Most recent"
          title="Pins"
          aside={
            <Button href="/pins" tone="pinned" variant="quiet" size="sm">
              All pins
            </Button>
          }
        >
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
        </Section>

        <Section eyebrow="Refused at settlement" title="Blocked calls">
          {blocked.length === 0 ? (
            <Card>
              <p className="font-display text-lg font-extrabold text-text">
                Nothing to show here yet
              </p>
              <p className="mt-2 text-sm leading-relaxed font-semibold text-muted">
                A refusal emits no event, deliberately: a log written before a revert is rolled back
                and never reaches an indexer. An earlier version did emit one, which made a refusal
                cost more gas than a success while still telling nobody. Reading them needs a node
                that can replay reverted transactions, which is the watcher&rsquo;s job rather than a
                browser&rsquo;s.
              </p>
            </Card>
          ) : (
            <RevealGroup className="space-y-3">
              {blocked.slice(0, 4).map((attempt) => (
                <RevealItem key={attempt.txHash}>
                  <Card className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1.5">
                        <Pill tone="revoked">refused</Pill>
                        <p className="text-sm font-bold text-text">{attempt.reason}</p>
                      </div>
                      <span className="text-xs font-semibold text-faint">
                        {timeAgo(attempt.timestamp)}
                      </span>
                    </div>

                    {attempt.attestedSkillHash === undefined ||
                    attempt.pinnedSkillHash === undefined ? null : (
                      <div className="mt-5 border-t border-line pt-5">
                        <FingerprintDiff
                          approved={attempt.pinnedSkillHash}
                          current={attempt.attestedSkillHash}
                          px={76}
                          labels={{ approved: "pinned", current: "attested" }}
                        />
                      </div>
                    )}
                  </Card>
                </RevealItem>
              ))}
            </RevealGroup>
          )}
        </Section>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- ledger */

/**
 * The registry's numbers, as a ledger rather than a row of tiles.
 *
 * One figure is set enormous and the rest sit beside it in a rule-separated column. Four equal cards
 * make four facts look equally important; this says which one matters and lets the eye move down
 * through the others.
 */
function Ledger({
  totals,
  pricing,
  source,
}: {
  totals: { livePins: number; pins: number; publishers: number; bondLocked: bigint; slashed: bigint };
  pricing: { bondAssetDecimals: number; bondAssetSymbol: string };
  source: DataSource;
}) {
  const bondWhole = Number(totals.bondLocked / 10n ** BigInt(pricing.bondAssetDecimals));
  const live = source.kind === "chain";

  const rows = [
    {
      label: "Bond locked",
      value: `${formatCount(bondWhole)} ${pricing.bondAssetSymbol}`,
      hint: "Committed against live version claims, and not withdrawable while they stand",
      tone: "text-pinned-ink",
    },
    {
      label: "Publishers",
      value: formatCount(totals.publishers),
      hint: "Distinct addresses that have published at least one pin",
      tone: "text-text",
    },
    {
      label: "Bond slashed",
      value: formatBond(totals.slashed, pricing.bondAssetDecimals),
      hint: "Taken from publishers caught making conflicting version claims",
      tone: totals.slashed > 0n ? "text-revoked-ink" : "text-faint",
    },
  ];

  /*
   * The heading has to change with the data, not just a badge somewhere near it.
   *
   * This section used to be titled "What is on chain right now" unconditionally, with the sample /
   * live distinction living only in a thin pill at the top of the page. A reviewer read the figures
   * as claims about a deployment and flagged, correctly, that a judge who opened a block explorer and
   * found nothing would conclude the project was lying. The pill was doing its job and losing the
   * argument, because a heading that says "on chain right now" outranks a 10px label thirty
   * centimetres above it.
   *
   * So the title itself states which it is, and the caveat sits directly against the numbers.
   */
  return (
    <Section
      eyebrow={live ? "Registry" : "Registry \u00b7 sample"}
      title={live ? "What is on chain right now" : "What this looks like with data in it"}
      description={
        live ? undefined : (
          <>
            No registry address is configured, so these are worked examples, not readings. Every
            figure below is derived from the sample fixtures rather than a deployment &mdash; the
            slashed total, for instance, is the sum of the bonds on pins the fixtures mark as slashed.
            Point <code className="hash text-xs font-bold text-text">NEXT_PUBLIC_PIN_REGISTRY</code>{" "}
            at a deployment and the same components read it instead.
          </>
        )
      }
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center 2xl:gap-8">
        <Reveal>
          <div>
            <p className="shout text-label text-faint">
              Live pins {live ? null : <span className="text-attention-ink">&middot; sample</span>}
            </p>
            {/* Deliberately oversized. One number should dominate, or none of them register. */}
            <p className="font-display text-5xl leading-[0.85] font-extrabold tracking-[-0.04em] text-bonded-ink sm:text-6xl xl:text-6xl">
              <CountUp value={totals.livePins} format={(n) => formatCount(Math.round(n))} />
            </p>
            <p className="measure mt-3 text-sm leading-relaxed font-semibold text-muted">
              Versions that can currently vouch for a transaction. {totals.pins} have been published
              in total, including those since revoked or slashed &mdash; a pin never disappears, it
              stops being live.
            </p>
          </div>
        </Reveal>

        <RevealGroup className="divide-y divide-line">
          {rows.map((row) => (
            <RevealItem key={row.label}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-5">
                <div className="space-y-1">
                  <p className="shout text-label text-faint">{row.label}</p>
                  <p className="measure text-xs leading-relaxed font-semibold text-muted">
                    {row.hint}
                  </p>
                </div>
                <p className={cx("font-display text-3xl leading-none font-extrabold", row.tone)}>
                  {row.value}
                </p>
              </div>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </Section>
  );
}
