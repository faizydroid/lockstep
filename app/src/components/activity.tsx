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

import { RevealGroup, RevealItem } from "./motion";
import { Empty, Pill, cx } from "./ui";

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
  const events = eventsOf(snapshot);

  if (events.length === 0) {
    return (
      <Empty title="Nothing recorded yet">
        Executions appear here as the guard checks them. Refusals are best-effort: the guard reverts, and a log
        written before a revert is rolled back and never reaches an indexer, so reading them needs a node that
        can replay reverted transactions.
      </Empty>
    );
  }

  return (
    <RevealGroup className="pop divide-y divide-line overflow-hidden rounded-xl bg-panel">
      {events.map((event) => (
        <RevealItem key={event.id}>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-5 py-4">
            <Pill tone={event.kind === "refused" ? "revoked" : "bonded"}>
              {event.kind === "refused" ? "refused" : "settled"}
            </Pill>

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
