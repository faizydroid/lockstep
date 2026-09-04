"use client";

/**
 * Who ERC-8004 lets vouch for a publisher, and who Lockstep counts.
 *
 * ## Why this panel exists at all
 *
 * ERC-8004's Reputation Registry lets anyone call `giveFeedback`, and its own Security
 * Considerations say so plainly: unfiltered aggregation is spam-vulnerable, and the standard
 * expects third parties to build the systems that score reviewers. The signature encodes that
 * expectation as a requirement, since `getSummary` takes a mandatory client set.
 *
 * So the standard asks for a curated client set and does not supply one. `LockstepLens` supplies
 * one, and this panel shows the curation rather than its output. That ordering is deliberate: a
 * single reputation number would be the least defensible thing on this dashboard, and
 * `lib/health.ts` already argues at length against inventing weighted scores. What is defensible
 * is the rule, stated, with each address it was applied to and the answer it gave.
 *
 * ## What the rule is
 *
 * An address counts as a reviewer for a publisher only if it currently approves at least one of
 * that publisher's live pins. That is checkable from chain state and it means something concrete:
 * the reviewer has that publisher's exact bytes authorised against its own funds. Rating a
 * publisher you never trusted with money costs nothing and says nothing.
 *
 * Sybil resistance is therefore economic, not absolute, and the panel says so. Manufacturing a
 * reviewer means standing up an account, delegating it under EIP-7702, and approving the
 * publisher's pin -- a real on-chain commitment rather than a free write.
 *
 * ## Why the candidates are so few
 *
 * The Lens verifies candidates; it does not discover them, because discovering them on chain would
 * mean enumerating a mapping. This dashboard can honestly see two kinds of address: the account it
 * is configured for, and the publishers in the registry. Proposing a longer list would look more
 * convincing without being more true.
 */

import type { ReviewerSet } from "@/lib/model";
import { Card, HashChip, Pill, Section, Stat, Table, Td, Th, cx } from "@/components/ui";
import { Reveal, RevealGroup, RevealItem } from "@/components/motion";

/**
 * Formats a signed fixed-point summary.
 *
 * Its own helper because `lib/bond.ts` deals in unsigned bigints against a token's decimals, and
 * `summaryValue` is an `int128` carrying its own scale from the registry. Reusing the bond
 * formatter would drop the sign, which on a reputation figure is the entire meaning.
 */
export function formatScore(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;

  if (decimals <= 0) return `${negative ? "-" : ""}${magnitude.toString()}`;

  const scale = 10n ** BigInt(decimals);
  const whole = magnitude / scale;
  const fraction = (magnitude % scale).toString().padStart(decimals, "0").replace(/0+$/, "");

  return `${negative ? "-" : ""}${whole.toString()}${fraction === "" ? "" : `.${fraction}`}`;
}

export function ReviewerPanel({ reviewers }: { reviewers: ReviewerSet }) {
  const eligible = reviewers.checks.filter((c) => c.eligible);

  return (
    <div className="space-y-8">
      <Reveal>
        <Section
          eyebrow="ERC-8004"
          title="Who is allowed to vouch"
          description={
            <>
              The Reputation Registry lets anyone leave feedback, and its own security notes say
              unfiltered aggregation is spam-vulnerable &mdash; <code>getSummary</code> takes a
              mandatory client set for exactly that reason. The standard asks for a curated set and
              does not provide one. <code>LockstepLens</code> provides it: an address counts as a
              reviewer for a publisher only if it currently approves one of that publisher&rsquo;s
              live pins, which means it has those exact bytes authorised against its own funds.
            </>
          }
        >
          <RevealGroup className="grid gap-4 sm:grid-cols-3 2xl:gap-6">
            <RevealItem>
              <Stat
                label="Verified reviewers"
                value={eligible.length}
                hint="Addresses that approve a live pin from a publisher in this registry. Checked by the Lens against chain state, not asserted by this page."
                // `exactOptionalPropertyTypes` is on, so a conditional spread rather than
                // `tone={cond ? "bonded" : undefined}` -- the prop is absent, not undefined.
                {...(eligible.length > 0 ? ({ tone: "bonded" } as const) : {})}
              />
            </RevealItem>
            <RevealItem>
              <Stat
                label="Candidates offered"
                value={reviewers.checks.length}
                hint="Every address this dashboard can honestly propose: the configured account, and the registry's publishers. The Lens decides which of them qualify."
              />
            </RevealItem>
            <RevealItem>
              <Stat
                label="Pins tested against"
                value={reviewers.pinsChecked.length}
                hint="Only live pins. A revoked or slashed pin proves nothing about present trust, so the Lens skips it."
                tone="pinned"
              />
            </RevealItem>
          </RevealGroup>
        </Section>
      </Reveal>

      <Reveal>
        <Table>
          <thead>
            <tr>
              <Th>Candidate</Th>
              <Th>Why it was offered</Th>
              <Th>Lens verdict</Th>
            </tr>
          </thead>
          <tbody>
            {reviewers.checks.map((check) => (
              <tr
                key={check.candidate}
                className={cx(
                  "transition-colors hover:bg-raise",
                  check.eligible ? "bg-bonded-tint" : undefined,
                )}
              >
                <Td>
                  <HashChip value={check.candidate} kind="address" />
                </Td>
                <Td className="text-muted">
                  {check.basis === "account"
                    ? "The account this dashboard is reading"
                    : "Publishes to this registry"}
                </Td>
                <Td>
                  {check.eligible ? (
                    <Pill tone="bonded" title="Approves a live pin, so it has bytes from this registry authorised against its own funds.">
                      verified reviewer
                    </Pill>
                  ) : (
                    <Pill
                      tone="attention"
                      title="Approves no live pin here. Not a judgement about the address, only that it has nothing at stake in this registry."
                    >
                      no stake here
                    </Pill>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Reveal>

      {reviewers.candidateCaveat === undefined ? null : (
        <Reveal>
          <Card tone="attention">
            <h3 className="font-display text-lg text-text">What this reading does not show</h3>
            <p className="mt-3 measure text-sm leading-relaxed text-muted">
              {reviewers.candidateCaveat}
            </p>
          </Card>
        </Reveal>
      )}

      <ScorePair reviewers={reviewers} />

      <Reveal>
        <Card className="bg-raise">
          <h3 className="font-display text-lg text-text">What this reads, and who can change it</h3>
          <p className="mt-3 measure text-sm leading-relaxed text-muted">
            The two registry addresses below were read off the Lens rather than taken from this
            build&rsquo;s configuration. Its <code>identity</code> and <code>reputation</code> are
            immutable, so what it reads is a fact about the deployment; asserting it from an
            environment variable would be a claim about one.
          </p>
          <dl className="mt-4 space-y-2 text-xs font-semibold text-faint">
            <div className="flex flex-wrap items-center gap-2">
              <dt>LockstepLens</dt>
              <dd>
                <HashChip value={reviewers.lens} kind="address" emphasis="quiet" />
              </dd>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <dt>Identity Registry</dt>
              <dd>
                <HashChip value={reviewers.identityRegistry} kind="address" emphasis="quiet" />
              </dd>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <dt>Reputation Registry</dt>
              <dd>
                <HashChip value={reviewers.reputationRegistry} kind="address" emphasis="quiet" />
              </dd>
            </div>
          </dl>
          <p className="mt-4 measure text-sm leading-relaxed text-muted">
            Both registries are UUPS proxies, and one key can replace the code behind either. That
            cuts against this project&rsquo;s own argument, so it is worth stating where it sits:
            the Lens holds no funds and grants no authority, and the enforcement path never consults
            it &mdash; a guarded call reads <code>PinRegistry</code> and nothing else. An upgrade
            here can make a number on this page wrong. It cannot move money.
          </p>
        </Card>
      </Reveal>
    </div>
  );
}

/**
 * The filtered figure next to the naive one.
 *
 * The gap between them is the argument for the filter, which is why the unfiltered number is shown
 * at all despite the contract documenting it as something never to use as a trust signal. Shown
 * alone it would be exactly the misleading figure it is labelled as; shown beside the filtered one
 * it is evidence.
 *
 * When there is nothing to show, this renders the reason instead of a zero. A zero would be a
 * claim about a publisher's standing; the reason is a claim about what has been registered, and
 * only the second one is true.
 */
function ScorePair({ reviewers }: { reviewers: ReviewerSet }) {
  const { filtered, unfiltered, scoresUnavailable } = reviewers;

  if (filtered === undefined && unfiltered === undefined) {
    return (
      <Reveal>
        <Card tone="attention">
          <h3 className="font-display text-lg text-text">No reputation summary to show</h3>
          <p className="mt-3 measure text-sm leading-relaxed text-muted">
            {scoresUnavailable ??
              "No ERC-8004 summary was available for these publishers."}
          </p>
          <p className="mt-3 measure text-sm leading-relaxed text-muted">
            The eligibility rule above does not depend on any of this. It is reading live, and it is
            the part that had to be built &mdash; a curated client set is the input ERC-8004 asks
            for and does not supply.
          </p>
        </Card>
      </Reveal>
    );
  }

  return (
    <Reveal>
      <Section
        eyebrow="The same call, two client sets"
        title="What the filter removes"
        description={
          <>
            Both figures come from one <code>getSummary</code> on one registry. The only difference
            is who was counted. The unfiltered number is the one a Sybil attacker can move at will,
            and it is here to be compared rather than trusted.
          </>
        }
      >
        <RevealGroup className="grid gap-4 sm:grid-cols-2 2xl:gap-6">
          <RevealItem>
            <Stat
              label="Verified reviewers only"
              value={
                filtered === undefined
                  ? "\u2014"
                  : formatScore(filtered.value, filtered.decimals)
              }
              hint={
                filtered === undefined
                  ? scoresUnavailable ?? "No eligible reviewers, so there is nothing to average."
                  : `${filtered.count.toString()} entries from ${filtered.reviewers.length} address(es) with a stake in these pins.`
              }
              tone="bonded"
            />
          </RevealItem>
          <RevealItem>
            <Stat
              label="Every client, unfiltered"
              value={
                unfiltered === undefined
                  ? "\u2014"
                  : formatScore(unfiltered.value, unfiltered.decimals)
              }
              hint={
                unfiltered === undefined
                  ? "The registry had no clients to summarise."
                  : `${unfiltered.count.toString()} entries from anyone who called giveFeedback. Never a trust signal on its own.`
              }
              tone="attention"
            />
          </RevealItem>
        </RevealGroup>
      </Section>
    </Reveal>
  );
}
