"use client";

/**
 * The hook: two fingerprints that disagree, and the refusal that follows.
 *
 * ## Two corrections to the brief, both about units and mechanism
 *
 * The brief asked for "62 bytes changed". The grid is not bytes. Each cell is one hex character of a
 * 64-character keccak digest, so the count is positions in the hash, and the number is derived from the
 * real hashes rather than written in. Calling it bytes would be wrong by a factor of two and wrong in kind:
 * a reader who counted 64 cells and was told "62 bytes" learns the page does not know what it is showing.
 *
 * The brief also asked the toast to read "Transaction Reverted. 1,250 AUSD Bond Slashed." Those are two
 * different mechanisms and only one of them is happening here. A hash mismatch reverts the call; nothing is
 * slashed. Slashing requires `proveEquivocation` -- a publisher signing two different byte sets under one
 * version string -- which is a separate act by a separate party at a separate time.
 *
 * So the toast says what actually happens, and it is more visceral for this audience anyway: the sum that
 * moved was zero. A security engineer does not want to be told a penalty fired; they want to be told the
 * money did not move.
 */

import { useMemo } from "react";

import { commonPrefixLength } from "@/lib/format";

/** One cell per hex character of the digest, coloured by whether the two hashes agree there. */
function cells(approved: string, current: string): readonly boolean[] {
  const a = approved.replace(/^0x/, "");
  const b = current.replace(/^0x/, "");
  return Array.from({ length: 64 }, (_, i) => a[i] === b[i]);
}

/**
 * Shown when no skill on this registry has drifted.
 *
 * The first version of the page handled this case by passing the same hash in twice, which rendered
 * "0 / 64 positions differ" underneath a revert toast -- a refusal illustrated with two identical hashes.
 * Incoherent, and the dishonest kind: it asserted a failure that had not happened.
 *
 * The alternative was to synthesise a second hash so the graphic always has something to show. That is
 * precisely the invented-evidence move this project refuses everywhere else, and it would be at its worst
 * here, in the panel doing the persuading.
 *
 * So the section keeps its position and tells the truth, which is good news rather than an empty state.
 */
function NoDrift() {
  return (
    <section className="mx-auto w-full max-w-5xl px-5 pb-16 sm:px-8 sm:pb-24">
      <div className="overflow-hidden rounded-lg border border-line bg-panel">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-raise px-4 py-2.5">
          <span className="hash text-label tracking-wide text-faint">DRIFT CHECK</span>
          <span className="hash text-label tracking-wide text-bonded-ink">0 SKILLS DIVERGED</span>
        </div>

        <div className="flex items-start gap-3 p-5 sm:p-6">
          <span aria-hidden className="mt-1 flex size-1.5 shrink-0 rounded-pill bg-bonded" />
          <div className="min-w-0">
            <p className="text-note font-medium text-text">
              Every approved skill on this registry still hashes to the bytes that were approved.
            </p>
            <p className="mt-2 max-w-2xl text-note leading-relaxed text-muted">
              Nothing is being refused right now, so there is no comparison to show you. This panel fills in
              with the two real fingerprints the moment a publisher ships an update, benign or not. It is not
              drawn from invented hashes in the meantime.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Hook({
  approvedHash,
  currentHash,
  live,
}: {
  /** Absent when nothing has drifted, which is a real state rather than missing data. */
  approvedHash: string | undefined;
  currentHash: string | undefined;
  live: boolean;
}) {
  if (approvedHash === undefined || currentHash === undefined || approvedHash === currentHash) {
    return <NoDrift />;
  }

  return <Diff approvedHash={approvedHash} currentHash={currentHash} live={live} />;
}

function Diff({
  approvedHash,
  currentHash,
  live,
}: {
  approvedHash: string;
  currentHash: string;
  live: boolean;
}) {
  const grid = useMemo(() => cells(approvedHash, currentHash), [approvedHash, currentHash]);
  const differing = grid.filter((same) => !same).length;
  const shared = commonPrefixLength(approvedHash, currentHash);

  return (
    <section className="mx-auto w-full max-w-5xl px-5 pb-16 sm:px-8 sm:pb-24">
      <div className="relative overflow-hidden rounded-lg border border-line bg-panel">
        {/* Terminal-style caption bar, so the panel reads as an instrument rather than a graphic. */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-raise px-4 py-2.5">
          <span className="hash text-label tracking-wide text-faint">
            SKILL: kuru-quote &middot; VERSION STRING UNCHANGED
          </span>
          <span className="hash text-label tracking-wide text-revoked-ink">
            {differing} / 64 HASH POSITIONS DIFFER
          </span>
        </div>

        <div className="grid gap-px bg-line sm:grid-cols-2">
          <Panel
            eyebrow="Approved bytes"
            hash={approvedHash}
            grid={grid}
            tone="bonded"
            note={`Matched for the first ${shared} characters, then diverges.`}
          />
          <Panel
            eyebrow="Bytes now shipping"
            hash={currentHash}
            grid={grid}
            tone="revoked"
            note="Same name. Same version string. Different code."
          />
        </div>

        {/*
          The verdict, spanning the seam between the two panels.

          Positioned in flow on small screens rather than absolutely: a toast overlapping a 64-cell grid on
          a 390px screen covers the evidence it is commenting on.
        */}
        <div className="border-t border-line bg-sunken px-4 py-4 sm:absolute sm:inset-x-0 sm:top-1/2 sm:-translate-y-1/2 sm:border-y sm:bg-transparent sm:px-6 sm:py-0">
          <div className="mx-auto flex max-w-md flex-col gap-3 rounded-md border border-revoked-ink/40 bg-[#1a0e0e] p-4 sm:flex-row sm:items-center">
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-revoked-tint">
              <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden="true">
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="var(--revoked-ink)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              </svg>
            </span>

            <div className="min-w-0">
              <p className="hash text-note font-medium text-revoked-ink">
                Transaction reverted &middot; NOT_PINNED
              </p>
              {/*
                The true version of the brief's slashing line. Zero moved is the fact that matters, and the
                second sentence keeps the two mechanisms apart so the page cannot be read as claiming that
                a refusal costs a publisher their bond.
              */}
              <p className="mt-1 text-label leading-relaxed text-muted">
                <span className="hash text-text">0 {live ? "" : "AUSD "}</span>
                moved. No bond was slashed &mdash; that requires proving the publisher signed two different
                byte sets under one version string.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Panel({
  eyebrow,
  hash,
  grid,
  tone,
  note,
}: {
  eyebrow: string;
  hash: string;
  grid: readonly boolean[];
  tone: "bonded" | "revoked";
  note: string;
}) {
  const ink = tone === "bonded" ? "text-bonded-ink" : "text-revoked-ink";

  return (
    <div className="bg-panel p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <span
          className={`size-1.5 rounded-pill ${tone === "bonded" ? "bg-bonded" : "bg-revoked"}`}
          aria-hidden
        />
        <span className="hash text-label tracking-wide text-faint">{eyebrow.toUpperCase()}</span>
      </div>

      {/*
        A 16-wide grid, which is 4 rows of a 64-character digest.

        Cells that agree are drawn in the panel's own tone; cells that differ are drawn in the other's, so
        the two sides are mirror images and the divergence lands in the same place on both. That is the
        whole point of showing them side by side.
      */}
      {/* 16 columns is not in Tailwind's default scale, which stops at 12. */}
      <div className="mt-4 grid grid-cols-[repeat(16,minmax(0,1fr))] gap-1" aria-hidden>
        {grid.map((same, i) => (
          <span
            key={i}
            className={`aspect-square rounded-[2px] ${
              same
                ? tone === "bonded"
                  ? "bg-bonded/70"
                  : "bg-bonded/25"
                : tone === "bonded"
                  ? "bg-line-strong"
                  : "bg-revoked"
            }`}
          />
        ))}
      </div>

      <p className={`hash mt-4 truncate text-label ${ink}`}>{hash}</p>
      <p className="mt-2 text-label leading-relaxed text-faint">{note}</p>
    </div>
  );
}
