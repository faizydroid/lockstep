"use client";

/**
 * The landing page.
 *
 * ## What changed and why
 *
 * This route used to be the landing page and the dashboard at once: a pitch, then a scoreboard, then a
 * ledger and two list columns. That made the first screen serve two readers with opposite questions. A
 * first-time reader is asking "what is this and why should I believe it"; a returning one is asking "is
 * anything wrong with my account". Answering both on one page means the second reader scrolls past a
 * poster every single visit, and the first meets an instrument they have no context for.
 *
 * So the instrument moved to `/dashboard` and this page keeps only the argument.
 *
 * ## The order is the argument
 *
 *   the claim          headline and pitch, plus who it is not for
 *   the mechanism      the settlement gate, which the reader operates themselves
 *   the evidence       two real fingerprints that disagree
 *   the boundary       what it does not stop
 *   the invitation     connect, or look around
 *
 * The ask is last on purpose. Everything above it works without a wallet, which is the whole reciprocity
 * argument from the onboarding material: a product that demands something before it gives anything reads
 * like a restaurant asking for a card before showing a menu. The gate in particular is the product's
 * entire thesis in one operable panel, and it is free.
 */

import { useSnapshot } from "@/components/data";
import { FingerprintDiff } from "@/components/fingerprint";
import { SettlementGate } from "@/components/gate";
import { Limits, NotFor } from "@/components/limits";
import { Reveal, motion, useReducedMotion } from "@/components/motion";
import { StartHere } from "@/components/start";
import { Card, Pill, Section } from "@/components/ui";

export default function LandingPage() {
  const { snapshot } = useSnapshot();
  const headline = snapshot.drifted[0];

  return (
    <div className="space-y-12">
      <Hero />

      {/* The mechanism, before any statistic about it and before anything is asked for. */}
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
          <Card className="p-8 sm:p-10">
            <div className="space-y-8">
              <FingerprintDiff approved={headline.approvedHash} current={headline.currentHash} />

              <div className="flex flex-wrap items-center gap-3 border-t border-line pt-6">
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
              </div>
            </div>
          </Card>
        </Section>
      )}

      {/*
        The boundary, immediately after the gate that demonstrates the mechanism.

        Position is the argument. Showing what it catches and then, in the next breath, what it does not
        is what makes the first half credible to a reader who was going to look for the edges anyway.
        Burying it below the invitation would turn it into small print.
      */}
      <Limits />

      <Reveal>
        <StartHere />
      </Reveal>
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
 *
 * The buttons changed with the split. They used to link straight to `/drift` and `/pins`, which became
 * a trap the moment this page got a flow behind it: a first-time reader would be steered back here by
 * the gate, having clicked something that looked like it worked. They are flow actions now, and the
 * product links live on the dashboard where a reader can actually follow them.
 */
function Hero() {
  return (
    <header className="relative pt-1">
      <Reveal>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-end lg:gap-8">
          <div className="space-y-4">
            <Pill tone="pinned">EIP-7702 &middot; enforced at settlement</Pill>

            {/*
              Still set tight and still allowed to behave like a poster, just not at the expense of
              the rest of the page. Baloo 2 at 800 rather than Nunito: at this size Nunito's
              roundness reads as soft, and the headline is the one place that should feel like a
              shout.
            */}
            <h1 className="font-display text-4xl leading-[0.94] font-extrabold tracking-[-0.03em] text-text sm:text-6xl xl:text-5xl">
              <WordsRise text="A lockfile for" />
              <br />
              <span className="text-bonded-ink">
                <WordsRise text="agent money." delay={0.16} />
              </span>
            </h1>
          </div>

          <div className="space-y-4 lg:pb-1.5">
            <p className="measure text-base leading-relaxed font-semibold text-muted sm:text-base">
              An agent&rsquo;s wallet can cap{" "}
              <em className="font-extrabold text-text not-italic">how much</em> it spends. It has no
              idea <em className="font-extrabold text-text not-italic">which code</em> asked.
              Lockstep binds every fund-moving call to the exact skill version its owner approved.
            </p>

            <StartHere compact />

            {/*
              Who it is not for, next to the pitch rather than buried.

              The onboarding material's rule is that you cannot onboard someone you do not understand,
              and that knowing the non-audience is a constraint worth using. A reader who spends five
              minutes working out the product does not apply to them concludes it is vague; one who is
              told in three lines concludes it is specific.
            */}
            <NotFor />
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
