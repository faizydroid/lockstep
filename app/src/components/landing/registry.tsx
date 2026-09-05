"use client";

/**
 * Live registry: a metrics row and a dense table, both read from the snapshot.
 *
 * ## Every figure here is derived, and that is the point of the section
 *
 * The brief supplied example values -- "Current Block: 145982", "Total Value Slashed: 1,625 AUSD",
 * `kuru-quote v1.4` with a bonded amount. None of them are hardcoded. This is the trust block on a page
 * arguing that a claim and a reading are different things, so numbers invented for the layout would
 * undercut the section they are decorating. A judge who cross-checks one figure against an explorer and
 * finds it fabricated has learned everything they need about the rest of the page.
 *
 * `source.blockNumber`, `totals.slashed`, `totals.bondLocked` and `pricing.bondAssetSymbol` all come off
 * the same read that fills the dashboard.
 *
 * ## Where the disclosure went
 *
 * This is where the source banner's warning now lives, instead of above the fold. On a build with no
 * registry configured the heading itself changes and a caveat sits directly against the numbers, which is
 * a stronger position: a caveat beside the figure it qualifies gets read, one at the top of the page is
 * furniture.
 */

import type { Certainty } from "@/components/data";
import { useExplore } from "@/components/start";
import { bondBreakdown } from "@/lib/bond";
import { formatBond, formatCount } from "@/lib/format";
import type { Pin, Snapshot } from "@/lib/model";
import { displayName } from "@/lib/untrusted";

export function Registry({ snapshot, certainty }: { snapshot: Snapshot; certainty: Certainty }) {
  const { source, totals, pricing } = snapshot;
  const live = certainty === "chain";
  const explore = useExplore();

  const metrics: readonly { label: string; value: string }[] = [
    {
      /*
       * Narrowed on `source.kind` rather than on `live`.
       *
       * `live` now comes from `certainty`, which the compiler cannot use to narrow the DataSource union — and
       * it is right not to: the two are only correlated, and `blockNumber` exists on exactly one member.
       */
      label: "Current block",
      value:
        source.kind === "chain"
          ? formatCount(Number(source.blockNumber))
          : certainty === "reading"
            ? "\u2026"
            : "\u2014",
    },
    { label: "Live pins", value: formatCount(totals.livePins) },
    {
      label: "Bond locked",
      value: `${formatBond(totals.bondLocked, pricing.bondAssetDecimals)} ${pricing.bondAssetSymbol}`,
    },
    {
      label: "Total slashed",
      value: `${formatBond(totals.slashed, pricing.bondAssetDecimals)} ${pricing.bondAssetSymbol}`,
    },
  ];

  return (
    <section className="border-y border-line bg-sunken">
      <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            {/*
              Three states, because two of them used to be one.

              "Worked example" was printed for the whole duration of the chain read as well as when there was
              genuinely no registry, so the section claimed the figures were invented before it had looked.
            */}
            <p className="shout text-label text-faint">
              {certainty === "chain"
                ? "Read from chain"
                : certainty === "reading"
                  ? "Reading"
                  : "Worked example"}
            </p>
            <h2 className="mt-2 text-2xl tracking-tight text-text sm:text-3xl">
              {certainty === "chain"
                ? "Live registry"
                : certainty === "reading"
                  ? "Reading the registry"
                  : "What the registry looks like with data in it"}
            </h2>
          </div>

          {/* Behind the first-run flow, so it records the choice rather than being bounced back. */}
          <button
            type="button"
            onClick={() => explore("/pins")}
            className="press inline-flex h-9 items-center rounded-md border border-line-strong px-4 text-label font-medium text-text transition-colors hover:bg-raise"
          >
            All pins
          </button>
        </div>

        {/*
          The disclosure, moved down here from above the fold and put against the numbers.

          Rendered only when it is true. An unconditional caveat is wallpaper; one that appears exactly when
          the figures are invented is information.
        */}
        {certainty === "sample" ? (
          <p className="mt-4 max-w-2xl text-note leading-relaxed text-attention-ink">
            No registry address is configured in this build, so every figure below is derived from sample
            fixtures rather than read from a deployment. Point{" "}
            <code className="hash text-label">NEXT_PUBLIC_PIN_REGISTRY</code> at one and the same components
            read it instead.
          </p>
        ) : certainty === "reading" ? (
          <p className="mt-4 max-w-2xl text-note leading-relaxed text-muted">
            Reading the registry now. The figures below are placeholders until it answers, and they will be
            replaced rather than adjusted.
          </p>
        ) : null}

        <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-4">
          {metrics.map((metric) => (
            <div key={metric.label} className="bg-panel px-4 py-4 sm:px-5 sm:py-5">
              <p className="hash text-label tracking-wide text-faint">
                {metric.label.toUpperCase()}
              </p>
              <p className="hash mt-2 text-lg font-medium tracking-tight text-text sm:text-xl">
                {metric.value}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-6 overflow-hidden rounded-lg border border-line bg-panel">
          {/*
            Horizontal scroll on a container rather than a wrapping table.

            A five-column table of hashes and amounts cannot reflow into 390px without becoming
            unreadable, so it scrolls and the first column is what stays useful at a glance.
          */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-raise">
                  {["Skill", "Version", "Publisher", "Bond", "Status"].map((head) => (
                    <th
                      key={head}
                      scope="col"
                      className="hash px-4 py-2.5 text-label font-normal tracking-wide text-faint"
                    >
                      {head.toUpperCase()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {snapshot.pins.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-note text-faint">
                      Nothing has been published to this registry yet. The first publish locks a bond
                      priced by how much the skill may do.
                    </td>
                  </tr>
                ) : (
                  snapshot.pins.slice(0, 6).map((pin) => (
                    <Row key={pin.pinId} pin={pin} snapshot={snapshot} />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Status dot and label per pin state. Green glows only when the pin can actually vouch for a call. */
const STATE: Record<Pin["state"], { dot: string; ink: string; label: string }> = {
  bonded: { dot: "bg-bonded", ink: "text-bonded-ink", label: "bonded" },
  pinned: { dot: "bg-pinned", ink: "text-pinned-ink", label: "no bond" },
  revoked: { dot: "bg-revoked", ink: "text-revoked-ink", label: "revoked" },
  equivocated: { dot: "bg-equivocated", ink: "text-equivocated-ink", label: "slashed" },
};

function Row({ pin, snapshot }: { pin: Pin; snapshot: Snapshot }) {
  const state = STATE[pin.state];
  const bond = bondBreakdown(pin, snapshot.pricing);

  return (
    <tr className="border-b border-line last:border-b-0 transition-colors hover:bg-raise">
      {/* Publisher-controlled, so it goes through displayName like everywhere else. */}
      <td className="hash px-4 py-3 text-note text-text">{displayName(pin.skillName)}</td>
      <td className="hash px-4 py-3 text-note text-muted">
        {displayName(pin.skillVersion, "\u2014")}
      </td>
      <td className="hash px-4 py-3 text-label text-faint">
        {pin.publisher.slice(0, 6)}&hellip;{pin.publisher.slice(-4)}
      </td>
      <td className="hash px-4 py-3 text-note text-muted">
        {formatBond(bond.total, snapshot.pricing.bondAssetDecimals)}{" "}
        <span className="text-faint">{snapshot.pricing.bondAssetSymbol}</span>
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden
            className={`relative flex size-1.5 rounded-pill ${state.dot} ${
              pin.state === "bonded" ? "live-ring text-bonded" : ""
            }`}
          />
          <span className={`hash text-label ${state.ink}`}>{state.label}</span>
        </span>
      </td>
    </tr>
  );
}
