"use client";

/**
 * Publishers, sorted by collateral at risk by default.
 *
 * The default ranking is the point. Reputation here is not a score somebody assigned; it is how much a
 * publisher stands to lose if they contradict themselves about what a version contains. Sorting by locked
 * bond therefore sorts by how much their claims are worth.
 *
 * The columns are sortable now, which does not weaken that. The default is unchanged and stated, so the
 * argument still lands on arrival; what is added is that a reader who wants the table ordered by slashes can
 * have it, which is what a table with a right-aligned numeric column implicitly promises. Before this, those
 * headers looked clickable and were not.
 */

import { useState } from "react";

import { useSnapshot } from "@/components/data";
import { FilterBar, matches } from "@/components/filters";
import type { FilterChip } from "@/components/filters";
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
import type { Publisher } from "@/lib/model";

/*
 * The sortable columns, and what "descending" means for each.
 *
 * Every one of these defaults to the direction a reader actually wants first. Biggest bond, most pins, most
 * slashes: the interesting end of a numeric column in this table is always the high end, and making the first
 * click ascending would mean two clicks to see anything. `address` is the exception and sorts ascending,
 * because a hex string has no interesting end -- it is there so a reader can find a specific one by eye.
 */
const SORTS = {
  bond: { label: "Bond locked", of: (p: Publisher) => p.lockedBond, dir: "desc" },
  pins: { label: "Pins", of: (p: Publisher) => BigInt(p.pinCount), dir: "desc" },
  slashes: { label: "Slashes", of: (p: Publisher) => BigInt(p.slashCount), dir: "desc" },
} as const;

type SortKey = keyof typeof SORTS;

export default function PublishersPage() {
  const { snapshot } = useSnapshot();
  const { publishers, pricing, pins, reviewers } = snapshot;

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("bond");

  const slashed = publishers.filter((p) => p.hasEquivocated);

  const visible = publishers
    .filter((publisher) => matches(search, publisher.address))
    /*
     * Copied before sorting. `publishers` comes off the shared snapshot every page reads, and `sort` mutates
     * in place -- reordering it here would silently reorder the table on `/dashboard` too.
     */
    .slice()
    .sort((a, b) => {
      const of = SORTS[sort].of;
      const left = of(a);
      const right = of(b);
      if (left === right) return 0;
      return right > left ? 1 : -1;
    });

  const chips: FilterChip[] = search.trim() === "" ? [] : [
    { label: `matching "${search.trim()}"`, onClear: () => setSearch("") },
  ];

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
    <div className="space-y-12">
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
                        <p className="shout text-label text-faint">You would earn</p>
                        <p className="font-display text-2xl leading-none font-extrabold text-bonded-ink">
                          {formatBondWith(
                            pricing,
                            challengerReward(e.bondAtStake, pricing.challengerRewardBps),
                          )}
                        </p>
                        <p className="text-label font-semibold text-muted">
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
          level={1}
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

          <FilterBar
            search={search}
            onSearch={setSearch}
            searchLabel="Search publishers by address"
            placeholder="Publisher address"
            chips={chips}
            onClearAll={() => setSearch("")}
            showing={visible.length}
            total={publishers.length}
            noun="publishers"
          />

          <Reveal>
            <Table>
              <thead>
                <tr>
                  <Th>Publisher</Th>
                  {/*
                    Sortable headers, as buttons inside the `th`.

                    `aria-sort` on the `th` is what makes the current order audible; a coloured arrow alone
                    tells a screen reader nothing. The button is inside rather than instead of the header cell
                    because the cell is the column's name and the button is a control on it.
                  */}
                  <SortableTh sortKey="bond" active={sort} onSort={setSort} />
                  <SortableTh sortKey="pins" active={sort} onSort={setSort} />
                  <SortableTh sortKey="slashes" active={sort} onSort={setSort} />
                  <Th>Standing</Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((publisher) => {
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
          {/*
            h2, was h3.

            The route's own heading is the `Section` above at level one, and the section that would have sat
            between them only renders when a publisher has actually equivocated. So on a healthy registry the
            outline jumped from h1 straight to h3 — a skipped level, which is the second most common heading
            defect after having no h1 at all. This note is one level below the page, so it is an h2.
          */}
          <h2 className="font-display text-lg text-text">Why slashing only punishes contradiction</h2>
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

/**
 * A column header that also sorts by its column.
 *
 * Only one direction per column, on purpose. A toggle would give a reader six orderings of a table whose
 * interesting end is always the high one, and the cost is not the code -- it is that the second click on
 * "Slashes" would show the publishers with the fewest slashes, which nobody asked for and which looks like
 * the sort broke.
 */
function SortableTh({
  sortKey,
  active,
  onSort,
}: {
  sortKey: SortKey;
  active: SortKey;
  onSort: (next: SortKey) => void;
}) {
  const on = active === sortKey;

  return (
    <Th className="text-right">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-pressed={on}
        title={on ? `Sorted by ${SORTS[sortKey].label.toLowerCase()}` : `Sort by ${SORTS[sortKey].label.toLowerCase()}`}
        className={cx(
          "press inline-flex items-center gap-1 rounded transition-colors",
          on ? "text-text" : "text-faint hover:text-muted",
        )}
      >
        {SORTS[sortKey].label}
        {/*
          The marker is reserved space either way, so switching columns does not shift the header row. It is
          `aria-hidden` because `aria-pressed` above already carries the state, and announcing both would
          read as "sorted, pressed".
        */}
        <span aria-hidden className={on ? "opacity-100" : "opacity-0"}>
          &darr;
        </span>
      </button>
    </Th>
  );
}
