"use client";

/**
 * Drift: skills whose bytes no longer match what was approved.
 *
 * The most important page here, and the one that earns a UI at all. The capability diff is
 * genuinely hard to read as CLI text -- two sets of (target, selector) pairs, one of which is a
 * superset -- and trivial to read as two coloured columns. Everything else in this app could
 * live in a terminal.
 */

import { useSnapshot } from "@/components/data";
import { FingerprintDiff } from "@/components/fingerprint";
import { GuardSays } from "@/components/guard";
import { Pop, Reveal, RevealGroup, RevealItem } from "@/components/motion";
import { Card, Empty, HashChip, HashDiff, Pill, Section, cx } from "@/components/ui";
import { Verify } from "@/components/verify";
import { formatNative } from "@/lib/format";
import type { Capability, CapabilityDelta } from "@/lib/model";

export default function DriftPage() {
  const { snapshot } = useSnapshot();
  const { drifted } = snapshot;

  /*
   * How many of these actually need a person.
   *
   * The distinction the whole page rests on: a release that only removes capabilities or lowers its
   * ceiling is narrowing and can be re-approved automatically, while one that adds a (target,
   * selector) pair or raises the ceiling is widening and must be looked at. Leading with the count of
   * the second kind is the difference between "you have 3 notifications" and "one of these can move
   * money the version you approved could not".
   */
  const widened = drifted.filter((skill) => skill.diff.widened).length;

  return (
    <div className="space-y-12">
      <Reveal>
        <Section
          eyebrow="Version drift"
          title="What changed since you approved it"
          description={
            <>
              An approval is for exact bytes, not for a name or a version string. When a
              publisher ships different code, the hash changes and the pin no longer matches, so
              every fund-moving call from that skill is refused until the account owner looks at
              the difference and decides again.
            </>
          }
        >
          {drifted.length === 0 ? (
            <Empty title="Nothing has drifted">
              Every approved skill on this account still hashes to the bytes that were approved.
              This page fills in when a publisher ships an update, whether benign or not.
            </Empty>
          ) : null}
        </Section>
      </Reveal>

      {/*
        Guard states the size of the decision before the diffs.

        This is the page where permission fatigue actually gets decided, so the summary is phrased as
        how many items need a human rather than how many changed. A reader who sees "two changed, one
        needs you" reads one diff carefully; a reader who sees "2 pending approvals" clicks twice.
      */}
      {drifted.length === 0 ? null : (
        <Pop delay={0.08}>
          <GuardSays mood="alarmed" size={104} label="Guard looks alarmed.">
            <span className="font-display block text-lg leading-tight font-extrabold">
              {widened === 0
                ? `${drifted.length} skill${drifted.length === 1 ? "" : "s"} changed, none of them widened.`
                : `${widened} of ${drifted.length} need${widened === 1 ? "s" : ""} your decision.`}
            </span>
            <span className="mt-1.5 block text-sm leading-relaxed font-semibold opacity-90">
              {widened === 0
                ? "Every change here removes a capability or lowers a ceiling, which cannot let the skill do anything the version you approved could not. These are safe to re-approve without reading the diff."
                : "A widened release can call something the version you approved could not, or move more native value per call. Those are the ones worth reading. The rest only narrow what the skill can do."}
            </span>
          </GuardSays>
        </Pop>
      )}

      <RevealGroup className="space-y-8">
        {drifted.map((skill) => (
          <RevealItem key={`${skill.account}-${skill.approvedPinId}`}>
            <Card>
              <div className="space-y-7">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <p className="font-display text-2xl leading-tight text-text">{skill.skillName}</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-faint">
                      <span>account</span>
                      <HashChip value={skill.account} kind="address" emphasis="quiet" />
                      <span>approved pin</span>
                      <HashChip value={skill.approvedPinId} emphasis="quiet" />
                    </div>
                  </div>

                  {skill.diff.widened ? (
                    <Pill tone="attention" title="A new power, or a higher native-value ceiling. This needs a human.">
                      widened &middot; approval required
                    </Pill>
                  ) : (
                    <Pill tone="bonded" title="Same powers as the approved version. Auto-approvable.">
                      capability identical
                    </Pill>
                  )}
                </div>

                {/*
                  The fingerprints first, the hex under them. The image answers "did this change"
                  instantly; the hex is there for anyone who wants to verify the image.
                */}
                <FingerprintDiff approved={skill.approvedHash} current={skill.currentHash} />

                <div className="rounded-xl bg-sunken p-4">
                  <HashDiff approved={skill.approvedHash} current={skill.currentHash} />
                </div>

                {/*
                  The one place `lockstep hash` is the right command rather than a chain read.
                  
                  Drift is a claim about bytes on a disk, so the check has to run against a disk. A reader
                  who has the skill checked out can produce the right-hand hash themselves; nobody has to
                  take the divergence on trust. `Verify` still refuses on a sample build, where these two
                  hashes are fixtures and the command would return something unrelated.
                */}
                <Verify
                  command={`npx lockstep hash "./${skill.skillName}"`}
                  expect={`${skill.currentHash} \u2014 the right-hand hash above, computed from your own copy of the bytes.`}
                  note="Point the path at wherever that skill is checked out; the name above is a label, not a guaranteed directory. This is the only check here that needs the skill locally, because drift is a statement about a disk rather than about the chain. The left-hand hash is what the registry holds; the right is what your disk says."
                />

                <Delta delta={skill.diff} />
              </div>
            </Card>
          </RevealItem>
        ))}
      </RevealGroup>

      <Reveal>
        <Card className="bg-raise">
          <h3 className="font-display text-lg text-text">Why a rebuild does not interrupt anyone</h3>
          <p className="mt-3 measure text-sm leading-relaxed text-muted">
            Widening means one of two things and nothing else: a new (target, selector) pair, or
            a strictly higher native-value ceiling. Removing a capability or lowering the ceiling
            is a narrowing and is auto-approved. A recompile that changes every byte but declares
            the same powers is therefore silent. That distinction is the difference between a
            permission system people read and one that trains them to click through.
          </p>
        </Card>
      </Reveal>
    </div>
  );
}

/** The capability delta, as three columns that can be scanned rather than parsed. */
function Delta({ delta }: { delta: CapabilityDelta }) {
  const ceilingChanged = delta.ceilingBefore !== delta.ceilingAfter;

  return (
    <div className="space-y-5 border-t-2 border-line pt-6">
      <div className="grid gap-4 md:grid-cols-3 2xl:gap-6">
        <Column
          title="Gained"
          tone="attention"
          empty="Nothing new"
          caps={delta.added}
          note="Powers the approved version did not have. Each one needs a fresh decision."
        />
        <Column
          title="Kept"
          tone="neutral"
          empty="Nothing carried over"
          caps={delta.unchanged}
          note="Declared by both versions."
        />
        <Column
          title="Dropped"
          tone="bonded"
          empty="Nothing removed"
          caps={delta.removed}
          note="A narrowing. Never requires re-approval."
        />
      </div>

      <div
        className={cx(
          "flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 text-sm",
          ceilingChanged ? "bg-attention-tint" : "bg-raise",
        )}
      >
        <span className="shout text-[0.65rem] text-faint">Native value ceiling</span>
        <span className="text-muted">{formatNative(delta.ceilingBefore)}</span>
        <span aria-hidden className="text-faint">&rarr;</span>
        <span className={ceilingChanged ? "font-semibold text-attention-ink" : "text-muted"}>
          {formatNative(delta.ceilingAfter)}
        </span>
        {delta.ceilingAfter > delta.ceilingBefore ? (
          <Pill tone="attention" className="ml-auto">
            raised
          </Pill>
        ) : delta.ceilingAfter < delta.ceilingBefore ? (
          <Pill tone="bonded" className="ml-auto">
            lowered
          </Pill>
        ) : (
          <Pill tone="neutral" className="ml-auto">
            unchanged
          </Pill>
        )}
      </div>
    </div>
  );
}

function Column({
  title,
  tone,
  caps,
  empty,
  note,
}: {
  title: string;
  tone: "attention" | "neutral" | "bonded";
  caps: readonly Capability[];
  empty: string;
  note: string;
}) {
  const accent = {
    attention: "text-attention-ink",
    neutral: "text-muted",
    bonded: "text-bonded-ink",
  }[tone];

  return (
    <div className="rounded-xl bg-raise p-4 chunk">
      <div className="flex items-center justify-between gap-2">
        <p className={cx("shout text-[0.65rem]", accent)}>{title}</p>
        <span className="rounded-pill bg-raise px-2 py-0.5 text-xs text-muted">{caps.length}</span>
      </div>

      {caps.length === 0 ? (
        <p className="mt-3 text-sm text-faint">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {caps.map((capability) => (
            <li key={`${capability.target}-${capability.selector}`} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <code className="hash text-xs text-text">{capability.label}</code>
                {capability.highRisk ? (
                  <Pill
                    tone="revoked"
                    title="Can grant an allowance, move tokens, or relocate authority. Carries a bond premium."
                  >
                    high risk
                  </Pill>
                ) : null}
              </div>
              <div className="flex items-center gap-1.5 text-[0.7rem] text-faint">
                <span>on</span>
                <HashChip value={capability.target} kind="address" emphasis="quiet" />
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 border-t-2 border-line pt-3 text-[0.7rem] leading-relaxed text-faint">{note}</p>
    </div>
  );
}
