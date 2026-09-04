"use client";

/**
 * Publishers, sorted by collateral at risk.
 *
 * The ranking is the point. Reputation here is not a score somebody assigned; it is how much a
 * publisher stands to lose if they contradict themselves about what a version contains. Sorting
 * by locked bond therefore sorts by how much their claims are worth.
 */

import { useSnapshot } from "@/components/data";
import { Reveal, RevealGroup, RevealItem } from "@/components/motion";
import { ReviewerPanel } from "@/components/reviewers";
import { Term } from "@/components/term";
import { displayName } from "@/lib/untrusted";
import { Card, Empty, HashChip, Pill, Section, Stat, Table, Td, Th, cx } from "@/components/ui";
import { WriteAction } from "@/components/write-action";
import { formatBondWith } from "@/lib/bond";
import { readConfig } from "@/lib/chain";
import { challengerReward, findEquivocations } from "@/lib/equivocation";
import { formatBps, formatDuration } from "@/lib/format";

export default function PublishersPage() {
  const { snapshot } = useSnapshot();
  const { publishers, pricing, pins, reviewers } = snapshot;

  const slashed = publishers.filter((p) => p.hasEquivocated);

  /*
   * Contradictions the registry would accept as proof right now.
   *
   * Slashing is permissionless, and that is worth nothing if noticing a violation requires writing a
   * script. Two live pins from one publisher under one version id is a claim that two different byte
   * sets are both the same release, which the contract can check for itself -- so the dashboard's job is
   * to find the pair and hand it over.
   */
  const open = findEquivocations(pins);
  const registryAddress =
    readConfig().registry ?? ("0x0000000000000000000000000000000000000000" as const);

  return (
    <div className="space-y-14">
      {open.length === 0 ? null : (
        <Reveal>
          <Section
            eyebrow="Provable now"
            title={
              open.length === 1
                ? "A publisher has contradicted themselves"
                : `${open.length} publishers have contradicted themselves`
            }
            description={
              <>
                Two live pins from one publisher share a version id, which means claiming that two
                different byte sets are both the same release. Anyone can submit the pair; the registry
                verifies it and pays{" "}
                {formatBps(pricing.challengerRewardBps)} of the slashed bond to whoever did.
              </>
            }
          >
            <RevealGroup className="space-y-4">
              {open.map((e) => (
                <RevealItem key={`${e.publisher}-${e.versionId}`}>
                  <Card tone="equivocated">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-2">
                        <p className="font-display text-xl leading-tight font-extrabold break-words text-text">
                          {displayName(e.skillName)}
                          {e.skillVersion === undefined ? null : (
                            <span className="ml-2 text-sm font-bold text-faint">
                              {displayName(e.skillVersion, "")}
                            </span>
                          )}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-faint">
                          <span>publisher</span>
                          <HashChip value={e.publisher} kind="address" emphasis="quiet" />
                          <span>version id</span>
                          <HashChip value={e.versionId} emphasis="quiet" />
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-faint">
                          <span>approved against</span>
                          <HashChip value={e.original.skillHash} emphasis="quiet" />
                          <span>contradicted by</span>
                          <HashChip value={e.conflicting.skillHash} emphasis="quiet" />
                        </div>
                      </div>

                      <div className="space-y-2 text-right">
                        <p className="shout text-[0.6rem] text-faint">You would earn</p>
                        <p className="font-display text-2xl leading-none font-extrabold text-bonded-ink">
                          {formatBondWith(
                            pricing,
                            challengerReward(e.bondAtStake, pricing.challengerRewardBps),
                          )}
                        </p>
                        <p className="text-[0.7rem] font-semibold text-muted">
                          of {formatBondWith(pricing, e.bondAtStake)} at stake
                        </p>
                        <WriteAction
                          name="slashEquivocation"
                          args={[e.original.pinId, e.conflicting.pinId]}
                          registry={registryAddress}
                          tone="equivocated"
                        />
                      </div>
                    </div>
                  </Card>
                </RevealItem>
              ))}
            </RevealGroup>
          </Section>
        </Reveal>
      )}

      <Reveal>
        <Section
          eyebrow="Skin in the game"
          title="Publishers"
          description={
            <>
              A publisher deposits collateral and locks part of it against every version they
              publish. If they ever ship two different byte sets under one version string &mdash;{" "}
              <Term name="equivocation">equivocation</Term> &mdash; anyone can prove it on chain and{" "}
              <Term name="slash">slash</Term> that <Term name="bond">bond</Term>. No committee, no
              judgement about whether the code was malicious &mdash; just a contradiction the chain can
              check.
            </>
          }
        >
          {publishers.length === 0 ? (
            <Empty title="No publishers yet">
              Nobody has published to this registry. The first publish locks a bond priced by how
              much the skill may do.
            </Empty>
          ) : null}
        </Section>
      </Reveal>

      {publishers.length === 0 ? null : (
        <>
          <RevealGroup className="grid gap-4 sm:grid-cols-3 2xl:gap-6">
            <RevealItem>
              <Stat
                label="Challenger reward"
                value={formatBps(pricing.challengerRewardBps)}
                hint="Share of a slashed bond paid to whoever proves the contradiction. The rest goes to the slash recipient."
                tone="pinned"
              />
            </RevealItem>
            <RevealItem>
              <Stat
                label="Unbonding delay"
                value={formatDuration(pricing.unbondingDelay)}
                hint="Between revoking a pin and reclaiming its bond, so evidence has time to surface."
              />
            </RevealItem>
            <RevealItem>
              <Stat
                label="Caught equivocating"
                value={slashed.length}
                hint="Publishers who made conflicting claims about one version. The mark is permanent."
                tone={slashed.length > 0 ? "revoked" : "bonded"}
              />
            </RevealItem>
          </RevealGroup>

          <Reveal>
            <Table>
              <thead>
                <tr>
                  <Th>Publisher</Th>
                  <Th className="text-right">Bond locked</Th>
                  <Th className="text-right">Pins</Th>
                  <Th className="text-right">Slashes</Th>
                  <Th>Standing</Th>
                </tr>
              </thead>
              <tbody>
                {publishers.map((publisher) => {
                  const theirPins = pins.filter(
                    (p) => p.publisher.toLowerCase() === publisher.address.toLowerCase(),
                  );
                  const live = theirPins.filter((p) => p.state === "bonded" || p.state === "pinned").length;

                  return (
                    <tr
                      key={publisher.address}
                      className={cx(
                        "transition-colors hover:bg-raise",
                        publisher.hasEquivocated ? "bg-equivocated-tint" : undefined,
                      )}
                    >
                      <Td>
                        <HashChip value={publisher.address} kind="address" />
                      </Td>
                      <Td className="text-right text-text">
                        {formatBondWith(pricing, publisher.lockedBond)}
                      </Td>
                      <Td className="text-right text-muted">
                        {live}
                        <span className="text-faint"> / {publisher.pinCount}</span>
                      </Td>
                      <Td className="text-right text-muted">
                        {publisher.slashCount === 0 ? (
                          <span className="text-faint">&mdash;</span>
                        ) : (
                          publisher.slashCount
                        )}
                      </Td>
                      <Td>
                        {publisher.hasEquivocated ? (
                          <Pill
                            tone="equivocated"
                            title="Proven to have published conflicting bytes under one version string."
                          >
                            equivocated
                          </Pill>
                        ) : publisher.lockedBond > 0n ? (
                          <Pill tone="bonded">bonded</Pill>
                        ) : (
                          <Pill tone="neutral">no bond locked</Pill>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Reveal>
        </>
      )}

      {/*
        Rendered only when a LockstepLens is configured and answering.
        Its absence is meaningful rather than a gap: the Lens reads two ERC-8004 registries this
        project neither deployed nor controls, so a chain without them has no Lens. An empty panel
        would imply a reading that never happened.
      */}
      {reviewers === undefined ? null : <ReviewerPanel reviewers={reviewers} />}

      <Reveal>
        <Card className="bg-raise">
          <h3 className="font-display text-lg text-text">Why slashing only punishes contradiction</h3>
          <p className="mt-3 measure text-sm leading-relaxed text-muted">
            Publishing a skill that turns out to be bad is not slashable, and deliberately so.
            Deciding whether code is malicious needs a court; deciding whether a publisher signed
            two different hashes for one version needs one comparison. Only the second is
            chain-decidable, so only the second carries a penalty. A guard refusing a call is not
            misbehaviour either &mdash; it is the system working &mdash; so that costs a publisher
            nothing.
          </p>
          <p className="mt-3 measure text-sm leading-relaxed text-muted">
            Bond release is frozen while a contradiction stands, and that freeze is permanent,
            because the evidence is. A publisher cannot revoke both conflicting pins, wait out the
            unbonding delay, and walk away with the collateral.
          </p>
        </Card>
      </Reveal>
    </div>
  );
}
