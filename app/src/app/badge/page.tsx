"use client";

/**
 * The embeddable badge, rendered by the real generator.
 *
 * `renderBadge` is imported from @lockstep/badge rather than reimplemented, so what a publisher
 * previews here is byte-identical to what lands in their README. A preview that merely
 * approximated the badge would be worse than none: it would drift, and the first person to
 * notice would be a publisher whose README looked wrong.
 */

import { useId, useMemo, useState } from "react";
import { renderBadge, badgeSnippet, LOCKSTEP_DASHBOARD } from "@lockstep/badge";
import type { BadgeInput, BadgeState } from "@lockstep/badge";

import { useSnapshot } from "@/components/data";
import { Reveal, SPRING_FIRM, motion } from "@/components/motion";
import { Card, Pill, Section, Segmented, cx } from "@/components/ui";
import { displayName } from "@/lib/untrusted";

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

  /*
   * Built by the same helper the CLI and the Action use, so this preview cannot drift from what a
   * publisher actually gets.
   *
   * It used to show a hosted URL -- `<host>/badge/kuru-quote.svg` -- which contradicted
   * the sentence directly above it about the badge not phoning home. A hosted image reports every
   * README view to whoever runs the host. The image path is relative because it is a file the publisher
   * commits; the link is absolute because a README is read on github.com and the registry is not there.
   */
  const livePin = snapshot.pins.find((p) => p.state === "bonded");

  /*
    The name is bounded before it reaches the snippet, not just before it reaches the screen.

    This output is markdown the reader is told to paste into a README, so a publisher-chosen name
    carrying brackets, parentheses or a bidi override could rewrite the surrounding link rather than sit
    inside it. `displayName` strips the invisible characters and caps the length; the markdown escaping
    itself belongs to `badgeSnippet`, which is where the syntax is known.
  */
  const snippet = badgeSnippet({
    skillName: displayName(livePin?.skillName, "kuru-quote"),
    pinId: livePin?.pinId ?? `0x${"0".repeat(64)}`,
    // The shared constant, not a copy. This page tells a reader to paste the snippet into a README,
    // so a preview showing a different host than the CLI writes would be actively misleading.
    dashboard: LOCKSTEP_DASHBOARD,
  });

  return (
    <div className="space-y-12">
      <Reveal>
        <Section
          level={1}
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
            <div className="space-y-6">
              <p className="shout text-label text-faint">Preview</p>

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
                {/*
                  The shared `Segmented`, replacing a bespoke row of chips.

                  This markup was byte-identical to the motion picker in `settings-panel.tsx` and two pixels
                  taller than the tabs on `/account`, so the app had four segmented controls at three sizes
                  with no way for a reader to tell that three of them are the same control.
                */}
                <p className="text-note text-text">State</p>
                <Segmented
                  label="Badge state"
                  value={state}
                  onChange={setState}
                  options={STATES.map((option) => ({
                    value: option.state,
                    label: option.label,
                    hint: option.why,
                  }))}
                />
                <p className="text-label leading-relaxed text-faint">
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
              <p className="shout text-label text-faint">
                Paste into a README
              </p>
              <pre className="mt-4 overflow-x-auto rounded-xl bg-sunken p-4 text-xs leading-relaxed text-muted">
                <code className="hash">{snippet.markdown}</code>
              </pre>
              <p className="mt-3 text-xs leading-relaxed text-faint">
                The badge links to the pin it describes, so a reader can check the claim rather than
                take the colour on trust. A badge nobody can verify is decoration.
              </p>
              <p className="mt-3 text-xs leading-relaxed text-faint">
                <code className="hash text-text">{snippet.fileName}</code> is a file you commit, which
                is why the image path is relative. <code className="hash">lockstep publish</code> writes
                it for you and prints this line; the GitHub Action puts both in the run summary.
              </p>
            </Card>

            <Card>
              <p className="shout text-label text-faint">
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
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
                  <Pill tone="bonded">from this registry</Pill>
                  <span className="text-xs break-words text-muted">
                    {displayName(livePin.skillName)} would render{" "}
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
  /*
   * `useId`, not a slug of the label.
   *
   * The id was `slider-${label}`, and the labels are prose: "Bond, whole units" and "High-risk
   * capabilities". That produced ids containing a comma and spaces, which are not valid in an id and break
   * the `htmlFor` association — so clicking the visible label did not focus the slider. Deriving an id from
   * copy is the bug; copy is allowed to contain anything.
   */
  const id = useId();

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-4">
        <label className="text-note text-text" htmlFor={id}>
          {label}
        </label>
        <span className="hash text-note text-muted">{value}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        /*
          `py-2` on a range gives the thumb a 32px hit band without changing the 6px track's appearance.
          The bare `h-1.5` track was a 6px target, which is unusable with a finger.
        */
        className="w-full cursor-pointer appearance-none rounded-pill bg-raise-strong py-2 accent-pinned"
      />
      <p className="text-label leading-relaxed text-faint">{hint}</p>
    </div>
  );
}
