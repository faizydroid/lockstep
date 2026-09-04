"use client";

/**
 * The embeddable badge, rendered by the real generator.
 *
 * `renderBadge` is imported from @lockstep/badge rather than reimplemented, so what a publisher
 * previews here is byte-identical to what lands in their README. A preview that merely
 * approximated the badge would be worse than none: it would drift, and the first person to
 * notice would be a publisher whose README looked wrong.
 */

import { useMemo, useState } from "react";
import { renderBadge, badgeMarkdown } from "@lockstep/badge";
import type { BadgeInput, BadgeState } from "@lockstep/badge";

import { useSnapshot } from "@/components/data";
import { Reveal, SPRING_FIRM, motion } from "@/components/motion";
import { Card, Pill, Section, cx } from "@/components/ui";

const STATES: readonly { state: BadgeState; label: string; why: string }[] = [
  { state: "bonded", label: "bonded", why: "Live, with collateral posted against the version claim." },
  { state: "pinned", label: "pinned", why: "Live, but nothing is at stake if the publisher equivocates." },
  { state: "unpinned", label: "unpinned", why: "No pin exists for these bytes at all." },
  { state: "revoked", label: "revoked", why: "The publisher withdrew this release." },
  { state: "equivocated", label: "equivocated", why: "Caught shipping conflicting bytes under one version." },
];

export default function BadgePage() {
  const { snapshot } = useSnapshot();

  const [state, setState] = useState<BadgeState>("bonded");
  const [bond, setBond] = useState(1500);
  const [highRiskCount, setHighRiskCount] = useState(0);

  const input: BadgeInput = useMemo(
    () => ({ state, bondWholeUnits: bond, highRiskCount }),
    [state, bond, highRiskCount],
  );

  const svg = useMemo(() => renderBadge(input), [input]);

  const markdown = badgeMarkdown(
    "https://lockstep.dev/badge/kuru-quote.svg",
    "https://lockstep.dev/pins?pin=0x\u2026",
  );

  const livePin = snapshot.pins.find((p) => p.state === "bonded");

  return (
    <div className="space-y-14">
      <Reveal>
        <Section
          eyebrow="Distribution"
          title="The badge"
          description={
            <>
              An SVG, not a hosted image. It renders in a README with no runtime, and it cannot
              phone home &mdash; which for a supply-chain security product is not a detail. A badge
              that beaconed on every page view would be indefensible.
            </>
          }
        />
      </Reveal>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] 2xl:gap-8">
        <Reveal>
          <Card>
            <div className="space-y-7">
              <p className="shout text-[0.65rem] text-faint">Preview</p>

              {/*
                Rendered as an image from a data URL rather than injected as markup. The generator
                escapes its inputs, but a preview that inlines generated SVG into this document
                would make any future escaping bug in the badge a scripting bug in this dashboard.
                An <img> cannot execute.
              */}
              <div className="grid place-items-center rounded-xl bg-raise px-6 py-12 chunk">
                <motion.img
                  key={svg}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={SPRING_FIRM}
                  src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
                  alt={`Lockstep badge showing state ${state}`}
                  className="h-6"
                />
              </div>

              <div className="space-y-3">
                <p className="text-sm text-text">State</p>
                <div className="flex flex-wrap gap-2">
                  {STATES.map((option) => (
                    <button
                      key={option.state}
                      type="button"
                      onClick={() => setState(option.state)}
                      title={option.why}
                      aria-pressed={state === option.state}
                      className={cx(
                        "shout press rounded-pill px-3.5 py-2 text-[0.65rem]",
                        state === option.state
                          ? "pop-sm bg-pinned-tint text-pinned-ink [--line:var(--pinned)] [--pop:var(--pinned-shade)]"
                          : "chunk bg-panel text-muted hover:text-text",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs leading-relaxed text-faint">
                  {STATES.find((o) => o.state === state)?.why}
                </p>
              </div>

              <Slider
                label="Bond, whole units"
                value={bond}
                min={0}
                max={5000}
                step={100}
                onChange={setBond}
                hint="Already scaled out of the bond asset's decimals, which is what the badge expects."
              />

              <Slider
                label="High-risk capabilities"
                value={highRiskCount}
                min={0}
                max={6}
                step={1}
                onChange={setHighRiskCount}
                hint="Above zero, a bonded badge turns amber rather than green. Bonded is not the same as harmless."
              />
            </div>
          </Card>
        </Reveal>

        <Reveal delay={0.06}>
          <div className="space-y-6">
            <Card>
              <p className="shout text-[0.65rem] text-faint">
                Paste into a README
              </p>
              <pre className="mt-4 overflow-x-auto rounded-xl bg-sunken p-4 text-xs leading-relaxed text-muted">
                <code className="hash">{markdown}</code>
              </pre>
              <p className="mt-3 text-xs leading-relaxed text-faint">
                The badge links to the pin it describes, so a reader can check the claim rather than
                take the colour on trust. A badge nobody can verify is decoration.
              </p>
            </Card>

            <Card>
              <p className="shout text-[0.65rem] text-faint">
                Why amber exists
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                A green badge on a skill that can call{" "}
                <code className="hash text-xs text-text">approve(address,uint256)</code> would be
                misleading. The bond is posted and the version claim is honest, but the skill can
                still grant an allowance over a whole balance. So a bonded pin with high-risk
                capabilities is amber: the publisher is accountable, and the power is real.
              </p>

              {livePin === undefined ? null : (
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t-2 border-line pt-4">
                  <Pill tone="bonded">from this registry</Pill>
                  <span className="text-xs text-muted">
                    {livePin.skillName ?? "unnamed skill"} would render{" "}
                    {livePin.capabilities.some((c) => c.highRisk) ? "amber" : "green"}
                  </span>
                </div>
              )}
            </Card>
          </div>
        </Reveal>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  hint: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-4">
        <label className="text-sm text-text" htmlFor={`slider-${label}`}>
          {label}
        </label>
        <span className="hash text-sm text-muted">{value}</span>
      </div>
      <input
        id={`slider-${label}`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-pill bg-raise-strong accent-pinned"
      />
      <p className="text-xs leading-relaxed text-faint">{hint}</p>
    </div>
  );
}
