"use client";

/**
 * Pin explorer, with the detail shown beside the list rather than on its own route.
 *
 * Selection lives in the query string. That is partly a constraint -- a static export cannot
 * pre-render `/pins/[pinId]` for ids that do not exist at build time -- and partly better: the
 * URL stays shareable, the list keeps its scroll position, and the detail panel can animate in
 * place, which makes it obvious which row it belongs to.
 */

import { useEffect, useState } from "react";

import { CapabilityConstellation } from "@/components/constellation";
import { useSnapshot } from "@/components/data";
import { FingerprintMark, HashFingerprint } from "@/components/fingerprint";
import { AnimatePresence, Reveal, RevealGroup, RevealItem, SPRING_SOFT, motion } from "@/components/motion";
import { Card, Empty, HashChip, Pill, Section, StatePill, cx } from "@/components/ui";
import { bondBreakdown, formatBondWith } from "@/lib/bond";
import { formatNative, timeAgo } from "@/lib/format";
import type { Pin } from "@/lib/model";
import { pinIdFromQuery } from "@/lib/untrusted";
import { readConfig } from "@/lib/chain";
import { useSettings } from "@/components/settings";
import { Verify } from "@/components/verify";
import { Term } from "@/components/term";

export default function PinsPage() {
  const { snapshot } = useSnapshot();

  /*
   * Selection is local state seeded from the URL, rather than useSearchParams.
   *
   * useSearchParams opts the route into a Suspense boundary, and under a static export the
   * fallback is what gets prerendered -- so the built page contained a skeleton and nothing
   * else, with the real list appearing only after hydration. Reading the query string once on
   * mount keeps deep links working, keeps the URL shareable through replaceState, and lets the
   * full list ship in the HTML.
   */
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  /*
   * Validated on the way in, not trusted because it fails harmlessly.
   *
   * A bogus id already matched no pin and fell through to the first one, so this fixes no live bug.
   * What it stops is holding an unbounded string from someone else's link in state that several
   * components read, which is the shape a real bug grows from later.
   */
  useEffect(() => {
    const fromUrl = pinIdFromQuery(window.location.search);
    if (fromUrl !== undefined) setSelectedId(fromUrl);
  }, []);

  const selected = snapshot.pins.find((p) => p.pinId === selectedId) ?? snapshot.pins[0];

  const select = (pinId: string) => {
    setSelectedId(pinId);
    // History rather than router.replace: this changes only which panel is open, and pushing a
    // navigation for that would make the back button step through panel selections.
    const url = new URL(window.location.href);
    url.searchParams.set("pin", pinId);
    window.history.replaceState(null, "", url);
  };

  return (
    <div className="space-y-10">
      <Reveal>
        <Section
          eyebrow="Registry"
          title="Published pins"
          description={
            <>
              Each <Term name="pin">pin</Term> binds one publisher&rsquo;s exact skill bytes to a declared
              set of on-chain powers, with a <Term name="bond">bond</Term> locked against the version
              claim.
            </>
          }
        >
          {snapshot.pins.length === 0 ? (
            <Empty title="No pins published">
              Nothing has been published to this registry yet. Publishing locks a bond priced by
              how much a skill may do, so an empty registry is the normal starting state rather
              than a failure.
            </Empty>
          ) : null}
        </Section>
      </Reveal>

      {/*
        The list narrows as the viewport grows and the detail panel takes the surplus. At full width
        an even split would give the list 900px for a two-line row, so the ratio shifts rather than
        the container capping.
      */}
      {snapshot.pins.length === 0 ? null : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] 2xl:gap-8">
          <RevealGroup className="space-y-3">
            {snapshot.pins.map((pin) => {
              const active = selected !== undefined && pin.pinId === selected.pinId;
              return (
                <RevealItem key={pin.pinId}>
                  <button
                    type="button"
                    onClick={() => select(pin.pinId)}
                    aria-current={active ? "true" : undefined}
                    className={cx(
                      "pop press relative block w-full overflow-hidden rounded-2xl p-5 text-left",
                      active
                        ? "bg-pinned-tint [--line:var(--pinned)] [--pop:var(--pinned-shade)]"
                        : "bg-panel hover:bg-raise",
                    )}
                  >
                    {active ? (
                      // One rail shared across rows via layoutId, so selecting a different pin
                      // slides the marker there. That movement is the only thing tying the detail
                      // panel to the row it came from. Thicker than the 3px of the previous design,
                      // to sit in a language where every other border is 2px.
                      <motion.span
                        layoutId="pin-selected"
                        transition={SPRING_SOFT}
                        className="absolute inset-y-3 left-0 w-1.5 rounded-pill bg-pinned"
                      />
                    ) : null}

                    <div className="flex flex-wrap items-center gap-4">
                      {/* The pin's face, derived from the same bytes as its hash, so the mark and
                          the label can never disagree. */}
                      <div className="rounded-lg bg-raise p-2 chunk">
                        <FingerprintMark hash={pin.skillHash} px={30} />
                      </div>

                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="font-display text-lg leading-tight text-text">
                          {pin.skillName ?? "unnamed skill"}
                          {pin.skillVersion === undefined ? null : (
                            <span className="ml-2 text-sm text-faint">{pin.skillVersion}</span>
                          )}
                        </p>
                        <p className="text-xs text-faint">
                          {pin.capabilities.length}{" "}
                          {pin.capabilities.length === 1 ? "capability" : "capabilities"} &middot;{" "}
                          {timeAgo(pin.publishedAt)}
                        </p>
                      </div>

                      <StatePill state={pin.state} />
                    </div>
                  </button>
                </RevealItem>
              );
            })}
          </RevealGroup>

          <div className="lg:sticky lg:top-6 lg:self-start">
            <AnimatePresence mode="wait" initial={false}>
              {selected === undefined ? null : (
                <motion.div
                  key={selected.pinId}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                >
                  <PinDetail pin={selected} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}

function PinDetail({ pin }: { pin: Pin }) {
  const { snapshot } = useSnapshot();
  const breakdown = bondBreakdown(pin, snapshot.pricing);
  const highRisk = pin.capabilities.filter((c) => c.highRisk);

  /*
   * The endpoint the page actually read, including a settings override.
   *
   * `readConfig()` alone would print the build's RPC, so a reader who had repointed the dashboard at
   * their own node would be handed a command checking a different endpoint from the one that produced the
   * numbers above it. That is the exact class of mismatch this component exists to rule out.
   */
  const { settings } = useSettings();
  const config = readConfig();
  const registry = config.registry ?? "0x0000000000000000000000000000000000000000";
  const rpcUrl = settings.rpcUrl ?? config.rpcUrl;

  return (
    <Card>
      <div className="space-y-7">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-4">
            <div className="rounded-xl bg-sunken p-2.5 chunk">
              <HashFingerprint hash={pin.skillHash} px={56} animate />
            </div>

            <div className="min-w-0 flex-1">
              <p className="font-display text-2xl leading-tight text-text">
                {pin.skillName ?? "unnamed skill"}
              </p>
              {pin.skillVersion === undefined ? null : (
                <p className="text-sm text-faint">{pin.skillVersion}</p>
              )}
            </div>

            <StatePill state={pin.state} />
          </div>

          <dl className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-[auto_minmax(0,1fr)]">
            <Field label="pin">
              <HashChip value={pin.pinId} />
            </Field>
            <Field label="skill hash">
              <HashChip value={pin.skillHash} />
            </Field>
            <Field label="version id">
              <HashChip value={pin.versionId} emphasis="quiet" />
            </Field>
            <Field label="publisher">
              <HashChip value={pin.publisher} kind="address" />
            </Field>
          </dl>

          {/*
            The hash above is the whole claim this page makes about this pin, so the command that checks
            it belongs next to it rather than in a docs page nobody opens.

            `liveSkillHash` and not `getPin`: it returns bytes32 rather than a struct, so the expected
            output is one line a reader can compare by eye, and it returns zero for a revoked or slashed
            pin — which means the same command also checks the state badge above.
          */}
          <Verify
            command={`cast call ${registry} "liveSkillHash(bytes32)(bytes32)" ${pin.pinId} --rpc-url ${rpcUrl}`}
            expect={
              pin.state === "revoked" || pin.state === "equivocated"
                ? "0x000\u20260 \u2014 zero, because a revoked or slashed pin has no live hash. That is the same fact the badge above states."
                : `${pin.skillHash} \u2014 the skill hash shown above, read straight off the registry.`
            }
            note="The registry answers with the hash the guard would compare against. If it disagreed with this page, this page would be wrong."
          />
        </div>

        <div className="space-y-3 border-t-2 border-line pt-5">
          <p className="shout text-[0.65rem] text-faint">
            What it may do on chain
          </p>

          {/*
            The one place "live hash" is worth defining, because the Verify block directly above reads it
            and a reader comparing the two needs to know that zero is a meaningful answer rather than a
            failed call.
          */}
          <p className="text-xs leading-relaxed font-semibold text-faint">
            The command above reads this pin&rsquo;s <Term name="live hash">live hash</Term>, which is
            what the <Term name="guard">guard</Term> compares against at{" "}
            <Term name="settlement">settlement</Term>.
          </p>

          {/*
            The shape first, the list after. Two pins with one capability each look identical in a
            list even when one only reads a price and the other can grant an allowance over a whole
            balance; the constellation shows that difference as reach and weight.
          */}
          <div className="grid gap-5 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)] sm:items-center">
            <CapabilityConstellation
              capabilities={pin.capabilities}
              movesNativeValue={pin.maxValuePerCall > 0n}
            />

            <ul className="space-y-2">
            {pin.capabilities.map((capability) => (
              <li
                key={`${capability.target}-${capability.selector}`}
                className="flex flex-wrap items-center gap-2 rounded-lg bg-raise px-3 py-2"
              >
                <code className="hash text-xs text-text">{capability.label}</code>
                <span className="text-[0.7rem] text-faint">on</span>
                <HashChip value={capability.target} kind="address" emphasis="quiet" />
                {capability.highRisk ? (
                  <Pill tone="revoked" className="ml-auto">
                    high risk
                  </Pill>
                ) : null}
              </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-muted">
            Native value ceiling: <span className="text-text">{formatNative(pin.maxValuePerCall)}</span>
            {pin.maxValuePerCall === 0n ? (
              <span className="text-faint"> &mdash; this skill cannot move native value at all</span>
            ) : null}
          </p>
        </div>

        <div className="space-y-3 border-t-2 border-line pt-5">
          <div className="flex items-center justify-between gap-3">
            <p className="shout text-[0.65rem] text-faint">
              Bond, priced by blast radius
            </p>
            <span className="font-display text-lg text-pinned-ink">
              {formatBondWith(snapshot.pricing, pin.requiredBond)}
            </span>
          </div>

          <ul className="space-y-1.5 text-xs">
            {breakdown.parts.map((part) => (
              <li key={part.label} className="flex flex-wrap items-baseline gap-2">
                <span className="text-muted">{part.label}</span>
                <span className="text-faint">{part.detail}</span>
                <span className="ml-auto text-text">
                  {formatBondWith(snapshot.pricing, part.amount)}
                </span>
              </li>
            ))}
          </ul>

          {breakdown.matchesChain ? null : (
            <p className="rounded-lg bg-attention-tint px-3 py-2 text-xs text-attention-ink">
              This breakdown does not sum to the bond recorded on chain. A pin&rsquo;s bond is
              frozen at publish time, so the registry&rsquo;s current prices can legitimately
              differ from the ones this pin was charged.
            </p>
          )}

          {highRisk.length === 0 ? null : (
            <p className="text-xs leading-relaxed text-muted">
              {highRisk.length} of these {highRisk.length === 1 ? "power" : "powers"} can grant an
              allowance or move tokens, which is why this pin costs more to publish than a
              read-only one. Breadth and severity set the price, not the value moved &mdash; a
              swap declares no native value and still needs approval to touch a balance.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="self-center shout text-[0.65rem] text-faint">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}
