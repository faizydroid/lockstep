"use client";

/**
 * What happened here, in one time-ordered list.
 *
 * ## Why this exists
 *
 * The app was keeping two halves of one record in two places and calling neither a record. Executions were a
 * table on `/approvals`; refusals were a column on the dashboard. Both are the same kind of fact — the guard
 * looked at a call and made a decision — and separating them meant no surface in the product answered "what
 * has this account been doing", which is the question an owner of an autonomous agent asks first.
 *
 * ## The event line, written to be read
 *
 * Every row is actor, action, object: who did it, what they did, and to what. That shape is not decoration —
 * it is what makes a dense feed scannable, because the eye learns where to look and stops re-parsing each
 * line. The failure mode it replaces is the templated entry: "Updated", "Transaction sent", a bare hash. Each
 * of those records that something happened while withholding the thing the reader wanted, which was what.
 *
 * ## Time, at two strengths
 *
 * Relative on the surface, absolute on demand. Scanning a feed, the reflex is to gauge recency, and an
 * absolute timestamp in a fixed zone makes that arithmetic on every line. But this is an audit trail as well
 * as a feed, and for anything contested the exact moment is the thing in question — so every row is a `<time>`
 * with a machine-readable UTC `dateTime`, reachable on hover and by anything parsing the page.
 *
 * ## Why the list can be short, and why that is said out loud
 *
 * A refusal emits no event. The guard reverts, and a log written before a revert is rolled back and never
 * reaches an indexer — an earlier version did emit one, which made refusing cost more gas than succeeding
 * while still telling nobody. Reading refusals needs a node that can replay reverted transactions, which is
 * the watcher's job rather than a browser's. So this feed is complete for executions and best-effort for
 * refusals, and saying so is the difference between an audit log and something that looks like one.
 */

import { explorerTxUrl } from "@/lib/chain";
import { shortAddress, shortHash, timeAgo } from "@/lib/format";
import type { Snapshot } from "@/lib/model";
import { displayName } from "@/lib/untrusted";

import { useCertainty } from "./data";
import { useEffect, useRef, useState } from "react";

import { RevealGroup, RevealItem } from "./motion";
import { useSettings } from "./settings";
import { Empty, Pill, Skeleton, cx } from "./ui";

interface Event {
  readonly id: string;
  readonly kind: "executed" | "refused";
  readonly at: bigint;
  readonly txHash: string;
  /** Who acted. Absent for a refusal, where the actor is the guard rather than an address. */
  readonly actor?: string;
  readonly action: string;
  readonly object: string;
}

/**
 * How many of these arrived since a given moment.
 *
 * `undefined` means no baseline, and returns 0 rather than the length. A reader on their first visit has not
 * failed to notice anything, so marking every row as new would be a notification about nothing -- and it is
 * the version of this feature that trains people to ignore the marker.
 *
 * Exported because it is the arithmetic behind a claim on screen, and the degenerate cases are exactly the
 * ones worth pinning: no baseline, a baseline in the future, and a baseline older than everything.
 */
export function countNewSince(events: readonly { readonly at: bigint }[], since: number | undefined): number {
  if (since === undefined) return 0;
  return events.filter((event) => event.at > BigInt(since)).length;
}

/**
 * Reads the stored baseline once, then records this visit.
 *
 * The order matters and is the whole trick. The baseline is captured into state on the first render after
 * settings load, *before* the write, so what the reader is shown is the moment before they arrived rather than
 * the moment they arrived -- which would always be zero.
 *
 * The write happens only on `chain`. Recording a visit off a fixture, or mid-read, would set the baseline from
 * data that is not the registry, and every genuinely new event after it would be marked as already seen. That
 * is a silent failure with no symptom, which is the worst kind to ship on an audit surface.
 */
function useLastSeen(): number | undefined {
  const { settings, loaded, update } = useSettings();
  const certainty = useCertainty();

  const [baseline, setBaseline] = useState<number | undefined>(undefined);
  const captured = useRef(false);

  useEffect(() => {
    if (!loaded || captured.current) return;
    captured.current = true;
    setBaseline(settings.lastSeenAt);
  }, [loaded, settings.lastSeenAt]);

  useEffect(() => {
    if (!loaded || certainty !== "chain") return;
    update({ lastSeenAt: Math.floor(Date.now() / 1000) });
  }, [loaded, certainty, update]);

  return baseline;
}

/**
 * Merges the two feeds and orders them.
 *
 * Exported so the ordering can be asserted against fixtures. A feed whose newest row is not at the top is a
 * feed a reader stops trusting after one glance, and that is a one-character mistake to make.
 */
export function eventsOf(snapshot: Snapshot, limit = 8): readonly Event[] {
  const named = (skillHash: string): string => {
    const pin = snapshot.pins.find((candidate) => candidate.skillHash === skillHash);
    if (pin === undefined || pin.skillName === undefined) return shortHash(skillHash);
    return `${displayName(pin.skillName)}${pin.skillVersion === undefined ? "" : ` ${displayName(pin.skillVersion, "")}`}`;
  };

  const executed: Event[] = snapshot.executions.map((execution) => ({
    id: `executed:${execution.txHash}`,
    kind: "executed",
    at: execution.timestamp,
    txHash: execution.txHash,
    actor: shortAddress(execution.executor),
    action: `settled ${execution.callCount} ${execution.callCount === 1 ? "call" : "calls"} against`,
    object: named(execution.skillHash),
  }));

  const refused: Event[] = snapshot.blocked.map((attempt) => ({
    id: `refused:${attempt.txHash}`,
    kind: "refused",
    at: attempt.timestamp,
    txHash: attempt.txHash,
    action: "refused a fund-moving call:",
    /*
     * The reason, straight from the revert.
     *
     * Not rewritten into friendlier language. This is the string the contract produced, and an audit line
     * that paraphrases the machine is a line a reader cannot match against a trace.
     */
    object: attempt.reason,
  }));

  return [...executed, ...refused].sort((a, b) => (a.at === b.at ? 0 : a.at > b.at ? -1 : 1)).slice(0, limit);
}

export function Activity({ snapshot }: { snapshot: Snapshot }) {
  const certainty = useCertainty();
  const events = eventsOf(snapshot);
  const since = useLastSeen();

  /*
   * While the read is in flight, rows rather than the fixture's rows.
   *
   * The same false-data problem the verdict had, and arguably a worse shape of it: an audit feed is the surface
   * a reader trusts to be a record. Showing four sample executions attributed to a sample executor, for a
   * second, on the page that claims to say what this account has done, teaches exactly the wrong lesson about
   * how much of this page is real.
   */
  if (certainty === "reading") {
    return (
      <div className="pop divide-y divide-line overflow-hidden rounded-xl bg-panel" aria-busy="true">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex items-center gap-3 px-5 py-4">
            <Skeleton className="h-5 w-16 rounded-pill" />
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <Empty title="Nothing recorded yet">
        Executions appear here as the guard checks them. Refusals are best-effort: the guard reverts, and a log
        written before a revert is rolled back and never reaches an indexer, so reading them needs a node that
        can replay reverted transactions.
      </Empty>
    );
  }

  const fresh = countNewSince(events, since);

  return (
    <div className="space-y-2">
      {/*
        The delta, and only when there is a baseline to measure against.

        A total on its own is nearly useless -- "14 events" says nothing a reader can act on, "3 new since you
        last looked" says whether to read the list. On a first visit there is no baseline, so nothing is
        claimed rather than everything being called new.
      */}
      {fresh === 0 ? null : (
        <p className="shout text-label text-pinned-ink">
          {fresh} new since you last looked
        </p>
      )}

    <RevealGroup className="pop divide-y divide-line overflow-hidden rounded-xl bg-panel">
      {events.map((event) => (
        <RevealItem key={event.id}>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-5 py-4">
            <Pill tone={event.kind === "refused" ? "revoked" : "bonded"}>
              {event.kind === "refused" ? "refused" : "settled"}
            </Pill>

            {/*
              "new" against the last time this browser actually read the chain.

              A word rather than a dot or a tinted row, for the same reason severity is a word in the queue:
              a marker carried by colour alone is invisible to a reader who cannot see the colour, and this
              one is the difference between an event they have already reviewed and one they have not.
            */}
            {since !== undefined && event.at > BigInt(since) ? <Pill tone="pinned">new</Pill> : null}

            <p className="min-w-0 flex-1 text-sm leading-relaxed font-semibold text-muted">
              {/*
                The actor first, in mono, because it is an address and an address is compared rather than
                read. Absent for a refusal: the actor there is the guard, and naming it would imply an
                address a reader could go and look up.
              */}
              {event.actor === undefined ? (
                <span className="text-text">Guard </span>
              ) : (
                <span className="hash text-text">{event.actor} </span>
              )}
              {event.action} <span className="text-text">{event.object}</span>
            </p>

            <span className="flex shrink-0 items-baseline gap-3">
              {/*
                Relative on the surface, exact underneath. `dateTime` is UTC and machine-readable, which is
                what makes this an audit line rather than a status update.
              */}
              <time
                dateTime={new Date(Number(event.at) * 1000).toISOString()}
                title={new Date(Number(event.at) * 1000).toISOString()}
                className="text-xs font-semibold text-faint"
              >
                {timeAgo(event.at)}
              </time>

              {/*
                The transaction, on an explorer this project does not control.

                The point of the link is that it is somewhere else. Every row above is this app's account of
                what happened; this is where a reader checks that account against a party with no stake in
                it, which is the same move every `Verify` block in the product makes.

                `explorerTxUrl` returns undefined when the configured chain has no explorer, and the hash is
                still printed in that case. A link to nowhere would be worse than plain text, and dropping
                the hash entirely would remove the identifier the reader needs to look it up themselves.
              */}
              <TxRef hash={event.txHash} />
            </span>
          </div>
        </RevealItem>
      ))}
    </RevealGroup>
    </div>
  );
}

/** The transaction hash, linked when there is somewhere to link it to and printed when there is not. */
function TxRef({ hash }: { hash: string }) {
  const url = explorerTxUrl(hash);
  const short = shortHash(hash, 4, 4);

  if (url === undefined) {
    return (
      <span className="hash text-xs font-semibold text-faint" title={hash}>
        {short}
      </span>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={hash}
      className={cx("hash text-xs font-semibold text-pinned-ink underline-offset-2 hover:underline")}
    >
      {short}
      <span className="sr-only"> — open this transaction on the block explorer</span>
    </a>
  );
}
