"use client";

/**
 * Overview.
 *
 * Rebuilt around one decision: the page leads with the mechanism, not with statistics. The previous
 * version opened with a headline and then four equal stat tiles, which is the layout of every
 * dashboard ever made and told a first-time reader nothing about what the product does.
 *
 * Now the fold is the gate -- a call arriving at the guard, which you can operate -- and the numbers
 * come after, because a total only means something once you know what it counts. The hierarchy is
 * deliberately uneven: one enormous figure, a wide interactive panel, then smaller supporting
 * columns. Equal-weight grids read as "we had four things"; uneven ones read as an argument.
 */

import Link from "next/link";

import { useSnapshot } from "@/components/data";
import { FingerprintDiff, FingerprintMark } from "@/components/fingerprint";
import { SettlementGate } from "@/components/gate";
import {
  CountUp,
  Reveal,
  RevealGroup,
  RevealItem,
  motion,
  useReducedMotion,
} from "@/components/motion";
import { Quickstart } from "@/components/quickstart";
import { Scoreboard } from "@/components/scoreboard";
import { Button, Card, Pill, Section, StatePill, cx } from "@/components/ui";
import { formatBond, formatCount, timeAgo } from "@/lib/format";
import type { DataSource } from "@/lib/model";

export default function OverviewPage() {
  const { snapshot } = useSnapshot();
  const { totals, pricing, pins, drifted, blocked } = snapshot;

  const headline = drifted[0];

  return (
    /*
     * Was `space-y-24`. Ninety-six pixels between every section is a magazine rhythm, and this page
     * has seven of them, so it cost about 280px of scroll on top of the hero. Fourteen still reads
     * as deliberate separation without making the reader work for it.
     */
    <div className="space-y-14 sm:space-y-16 2xl:space-y-20">
      <Hero />

      {/*
        Before the scoreboard, because a first-time reader's question is "what is this and what do I
        do" while a returning one's is "is anything wrong". It removes itself once dismissed, so the
        returning case pays nothing for it.
      */}
      <Quickstart />

      {/*
        The state of the account, delivered by the mascot, before anything else.

        This is where Duolingo puts its streak and XP row, and the position is right for the same
        reason: a returning user's first question is "is anything wrong", and it should be answered
        above the fold without reading. Every figure in it is a ratio over registry data -- see
        lib/health.ts for the ones that were cut for being unfalsifiable.
      */}
      <Reveal delay={0.06}>
        <Scoreboard snapshot={snapshot} />
      </Reveal>

      {/* The mechanism, before any statistic about it. */}
      <Reveal delay={0.1}>
        <SettlementGate />
      </Reveal>

      {headline === undefined ? null : (
        <Section
          eyebrow="The case it exists for"
          title="Approved once. Then the bytes changed."
          description={
            <>
              A publisher shipped different code under the same version string. Nothing about the
              name or the version number changed, so a policy that trusts labels would have allowed
              it. These are the two fingerprints, and the count between them is how many of the 64
              positions in the hash disagree.
            </>
          }
        >
          <Card spotlight className="p-8 sm:p-10">
            <div className="space-y-8">
              <FingerprintDiff approved={headline.approvedHash} current={headline.currentHash} />

              <div className="flex flex-wrap items-center gap-3 border-t-2 border-line pt-6">
                <Pill tone="revoked">refused &middot; NOT_PINNED</Pill>
                {headline.diff.widened ? (
                  <Pill tone="attention">capability widened</Pill>
                ) : (
                  <Pill tone="bonded">capability identical</Pill>
                )}
                <span className="text-sm font-semibold text-muted">
                  and {headline.diff.added.length} new{" "}
                  {headline.diff.added.length === 1 ? "power" : "powers"} the approved version never
                  had
                </span>
                <Button href="/drift" tone="revoked" variant="quiet" size="sm" className="ml-auto">
                  See what changed
                </Button>
              </div>
            </div>
          </Card>
        </Section>
      )}

      <Ledger totals={totals} pricing={pricing} source={snapshot.source} />

      {/* Two unequal columns: the pin list carries more weight than the refusal note beside it. */}
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] 2xl:gap-14">
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
                        <p className="font-display text-lg leading-tight font-extrabold text-text">
                          {pin.skillName ?? "unnamed skill"}
                          {pin.skillVersion === undefined ? null : (
                            <span className="ml-2 text-sm font-bold text-faint">
                              {pin.skillVersion}
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
                      <div className="mt-5 border-t-2 border-line pt-5">
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

/* ---------------------------------------------------------------------- hero */

/**
 * The pitch, in a band rather than a screen.
 *
 * This was a stacked column -- eyebrow, then a 6.5rem headline, then a four-line paragraph -- and
 * measured against the type scale it came to roughly 610px of preamble once the source banner and
 * `main`'s own padding were counted. On a laptop that is about seventy percent of the fold, so the
 * scoreboard answering "is anything wrong with my account" sat below it and a first-time reader met
 * a poster instead of a product.
 *
 * Two changes, both structural rather than cosmetic. The headline and the explanation now sit side
 * by side from `lg`, which takes the paragraph out of the vertical stack entirely instead of merely
 * shortening it. And the headline drops from 6.5rem to 4.5rem, which at this line count is worth
 * about 70px and still reads as the largest thing on the page by a wide margin.
 *
 * The paragraph itself lost its third sentence. What it said -- that the call is refused on chain
 * when the bytes change -- is demonstrated by the gate immediately below, and prose that describes
 * a working demonstration two hundred pixels above it is asking to be read twice.
 */
function Hero() {
  return (
    <header className="relative pt-1">
      <Reveal>
        <div className="grid gap-7 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-end lg:gap-12">
          <div className="space-y-4">
            <Pill tone="pinned">EIP-7702 &middot; enforced at settlement</Pill>

            {/*
              Still set tight and still allowed to behave like a poster, just not at the expense of
              the rest of the page. Baloo 2 at 800 rather than Nunito: at this size Nunito's
              roundness reads as soft, and the headline is the one place that should feel like a
              shout.
            */}
            <h1 className="font-display text-[2.5rem] leading-[0.94] font-extrabold tracking-[-0.03em] text-text sm:text-6xl xl:text-[4.5rem]">
              <WordsRise text="A lockfile for" />
              <br />
              <span className="text-bonded-ink">
                <WordsRise text="agent money." delay={0.16} />
              </span>
            </h1>
          </div>

          <div className="space-y-5 lg:pb-1.5">
            <p className="measure text-base leading-relaxed font-semibold text-muted sm:text-[1.0625rem]">
              An agent&rsquo;s wallet can cap{" "}
              <em className="font-extrabold text-text not-italic">how much</em> it spends. It has no
              idea <em className="font-extrabold text-text not-italic">which code</em> asked.
              Lockstep binds every fund-moving call to the exact skill version its owner approved.
            </p>

            {/*
              The fold now offers something to do. It had no call to action at all, which for the
              first screen of a demo is a strange omission -- a reader convinced by the headline had
              nowhere to go but scroll.
            */}
            <div className="flex flex-wrap items-center gap-3">
              <Button href="/drift" tone="revoked" size="sm">
                See a refused call
              </Button>
              <Button href="/pins" tone="pinned" variant="quiet" size="sm">
                Browse pins
              </Button>
            </div>
          </div>
        </div>
      </Reveal>
    </header>
  );
}

/**
 * Splits a headline into words that rise independently.
 *
 * Words, not letters. Letter-by-letter animation makes text unreadable while it plays and destroys a
 * screen reader's word boundaries, for an effect that is a decade past being novel.
 */
function WordsRise({ text, delay = 0 }: { text: string; delay?: number }) {
  const still = useReducedMotion();
  const words = text.split(" ");

  if (still) return <>{text}</>;

  return (
    <>
      {words.map((word, index) => (
        <span key={`${word}-${index}`} className="inline-block overflow-hidden pb-[0.09em] align-bottom">
          <motion.span
            className="inline-block"
            initial={{ y: "110%" }}
            animate={{ y: 0 }}
            transition={{ duration: 0.75, delay: delay + index * 0.06, ease: [0.22, 1, 0.36, 1] }}
          >
            {word}
            {index < words.length - 1 ? "\u00a0" : ""}
          </motion.span>
        </span>
      ))}
    </>
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
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center 2xl:gap-16">
        <Reveal>
          <div>
            <p className="shout text-[0.65rem] text-faint">
              Live pins {live ? null : <span className="text-attention-ink">&middot; sample</span>}
            </p>
            {/* Deliberately oversized. One number should dominate, or none of them register. */}
            <p className="font-display text-[5.5rem] leading-[0.85] font-extrabold tracking-[-0.04em] text-bonded-ink sm:text-[8rem] xl:text-[10rem]">
              <CountUp value={totals.livePins} format={(n) => formatCount(Math.round(n))} />
            </p>
            <p className="measure mt-3 text-sm leading-relaxed font-semibold text-muted">
              Versions that can currently vouch for a transaction. {totals.pins} have been published
              in total, including those since revoked or slashed &mdash; a pin never disappears, it
              stops being live.
            </p>
          </div>
        </Reveal>

        <RevealGroup className="divide-y-2 divide-line">
          {rows.map((row) => (
            <RevealItem key={row.label}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-5">
                <div className="space-y-1">
                  <p className="shout text-[0.65rem] text-faint">{row.label}</p>
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
