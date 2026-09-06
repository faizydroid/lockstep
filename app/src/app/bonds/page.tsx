"use client";

/**
 * Bond pricing, made legible and playable.
 *
 * The calculator is the reason this page exists. "Bonds are priced by blast radius" is an
 * abstract claim until someone drags the high-risk count from zero to two and watches the number
 * multiply. It reads the same immutables the registry uses, so what it shows is what a publisher
 * would actually be charged.
 */

import { useMemo, useState } from "react";
import { toFunctionSelector } from "viem/utils";
import type { Address } from "viem";

import { CapabilityConstellation } from "@/components/constellation";
import { useSnapshot } from "@/components/data";
import { Collapse, Reveal, RevealGroup, RevealItem, SPRING_FIRM, motion } from "@/components/motion";
import { Card, Pill, Section, Stat, cx } from "@/components/ui";
import { formatBondWith } from "@/lib/bond";
import { formatBps, formatDuration } from "@/lib/format";
import type { Capability } from "@/lib/model";

export default function BondsPage() {
  const { snapshot } = useSnapshot();
  const { pricing } = snapshot;

  const [capabilities, setCapabilities] = useState(3);
  const [highRisk, setHighRisk] = useState(1);
  const [movesNative, setMovesNative] = useState(false);
  const [showWhy, setShowWhy] = useState(false);

  // Clamped so the two counts stay coherent: a high-risk capability is still a capability.
  const effectiveHighRisk = Math.min(highRisk, capabilities);

  /*
   * A stand-in capability set for the constellation.
   *
   * Real selectors rather than placeholders, taken from the twelve the registry actually treats as
   * high risk, so the labels a publisher sees while pricing are the labels that would appear on the
   * pin. Targets are distinct per arm because two capabilities on one target are still two arms.
   */
  const preview = useMemo<Capability[]>(() => {
    const risky = ["approve(address,uint256)", "transferFrom(address,address,uint256)", "setApprovalForAll(address,bool)"];
    const benign = ["swap(uint256)", "quote(uint256)", "deposit(uint256)", "withdraw(uint256)"];

    return Array.from({ length: capabilities }, (_unused, index) => {
      const isRisky = index < effectiveHighRisk;
      const pool = isRisky ? risky : benign;
      const signature = pool[index % pool.length] as string;

      return {
        target: `0x${String(index + 1).padStart(40, "0")}` as Address,
        selector: toFunctionSelector(signature),
        label: signature,
        highRisk: isRisky,
      };
    });
  }, [capabilities, effectiveHighRisk]);

  const parts = [
    { label: "Base", amount: pricing.baseBond, detail: "charged on any publish at all" },
    {
      label: `Capabilities \u00d7 ${capabilities}`,
      amount: pricing.perCapabilityBond * BigInt(capabilities),
      detail: "how many distinct (target, selector) pairs it may call",
    },
    {
      label: `High risk \u00d7 ${effectiveHighRisk}`,
      amount: pricing.highRiskBond * BigInt(effectiveHighRisk),
      detail: "selectors that grant allowances, move tokens, or relocate authority",
    },
    {
      label: "Native value",
      amount: movesNative ? pricing.nativeValueBond : 0n,
      detail: "a flat premium for being able to move native value at all",
    },
  ];

  const total = parts.reduce((sum, p) => sum + p.amount, 0n);

  return (
    <div className="space-y-12">
      <Reveal>
        <Section
          level={1}
          eyebrow="Blast radius, not value"
          title="What a pin costs to publish"
          description={
            <>
              The bond is priced by how much damage a skill could do if its publisher lied, not by
              how much money passes through it. A swap that declares no native value can still
              drain a balance through an allowance, so value moved is the wrong axis. Breadth and
              severity are the right ones.
            </>
          }
        />
      </Reveal>

      {/*
        The disclosure that makes every figure on this page honest.

        This page turns a bond into a number with a currency beside it, which reads as an economic
        guarantee. On the deployment it reads from, it is not one: the bond asset is a mock with an
        unpermissioned `mint`, so anyone can post any bond for free. The accounting is real and the
        slashing works; the collateral cost nothing.

        Stating it here rather than in a README is the whole point -- a reader who never opens the
        repository is exactly the reader who would otherwise take the number at face value. The
        alternative, showing the figures without this, is claiming a guarantee the chain does not
        provide, which is the specific failure this project exists to argue against.

        `scripts/check-export.mjs` greps the exported HTML for this sentence, because an honest page
        and an overclaiming one look identical in a screenshot.
      */}
      <Reveal>
        <Card>
          <div className="space-y-2">
            <p className="shout text-label text-faint">What these numbers are worth</p>
            <p className="text-sm text-muted">
              On this testnet deployment the bond asset is a freely mintable mock, so a bond costs
              nothing to post and none of these figures represent capital actually at risk. The
              pricing, the accounting and the slashing are real and are exercised by tests; the
              money is not. A mainnet registry is required by the deploy script to name a real
              asset, because a registry whose bonds are worthless is worse than no registry.
            </p>
          </div>
        </Card>
      </Reveal>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] 2xl:gap-8">
        <Reveal>
          <Card>
            {/*
              The controls, then the diagram, and the whole card sized to fit above the fold.

              ## Why this got shorter

              It did not fit. The two steppers each carried a two-line hint and the native-value row carried a
              four-line paragraph about dimensional analysis, which put roughly 420px of prose between the top
              of the card and the drawing. So a reader would change a count and see nothing happen, because the
              thing that responds was below the fold -- on the one page in the app whose entire argument is
              watching the shape and the figure move together.

              What went is the length, not the reasoning. The hints are one line each now, and the paragraph
              moved into the "Why these numbers" disclosure in the card beside this one, which is exactly what
              that disclosure is for.
            */}
            <div className="space-y-4">
              <p className="shout text-label text-faint">Price a manifest</p>

              {/*
                One divided list rather than two steppers and a separately-boxed switch.

                The switch used to sit in its own tinted panel, which made it look like a different kind of
                thing from the counters above it. All three are the same kind of thing: an input to the price.
              */}
              <div className="divide-y divide-line">
                <Control
                  label="Declared capabilities"
                  hint="Distinct target and selector pairs, 64 max"
                >
                  <Stepper
                    label="Declared capabilities"
                    value={capabilities}
                    min={1}
                    max={12}
                    onChange={(next) => {
                      setCapabilities(next);
                      if (highRisk > next) setHighRisk(next);
                    }}
                  />
                </Control>

                <Control
                  label="Of which high risk"
                  hint="approve, transfer, permit, delegate and eight more"
                >
                  <Stepper
                    label="Of which high risk"
                    value={effectiveHighRisk}
                    min={0}
                    max={capabilities}
                    onChange={setHighRisk}
                  />
                </Control>

                <Control label="Can move native value" hint="A flat premium, not a share of the ceiling">
                  <Toggle checked={movesNative} onChange={setMovesNative} label="Can move native value" />
                </Control>
              </div>

              {/*
                The shape the price is charged for, drawn from the same counters.

                This page's whole claim is that the bond tracks blast radius rather than value moved. Two number
                inputs and a total do not show that; watching the constellation sprawl as you add powers, and the
                figure climb with it, is the argument itself. Same component as the pin detail view, so what a
                publisher previews here is what a reviewer will see.
              */}
              <div className="rounded-xl bg-sunken p-4 chunk">
                <CapabilityConstellation capabilities={preview} movesNativeValue={movesNative} />
              </div>
            </div>
          </Card>
        </Reveal>

        <Reveal delay={0.06}>
          <Card>
            <div className="space-y-6">
              <div className="flex items-end justify-between gap-4">
                <p className="shout text-label text-faint">
                  Bond required
                </p>
                <motion.p
                  key={total.toString()}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={SPRING_FIRM}
                  className="font-display text-3xl leading-none text-pinned-ink"
                >
                  {formatBondWith(pricing, total)}
                </motion.p>
              </div>

              <ul className="space-y-2">
                {parts.map((part) => {
                  const share = total === 0n ? 0 : Number((part.amount * 1000n) / total) / 10;
                  return (
                    <li key={part.label} className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className={part.amount === 0n ? "text-faint" : "text-text"}>
                          {part.label}
                        </span>
                        <span className={part.amount === 0n ? "text-faint" : "text-muted"}>
                          {formatBondWith(pricing, part.amount)}
                        </span>
                      </div>

                      {/* A bar, so the dominant term is obvious without reading the numbers. */}
                      <div className="h-1.5 overflow-hidden rounded-pill bg-raise">
                        <motion.div
                          className={cx(
                            "h-full rounded-pill",
                            part.amount === 0n ? "bg-transparent" : "bg-pinned",
                          )}
                          animate={{ width: `${share}%` }}
                          transition={SPRING_FIRM}
                        />
                      </div>

                      <p className="text-label leading-relaxed text-faint">{part.detail}</p>
                    </li>
                  );
                })}
              </ul>

              <button
                type="button"
                onClick={() => setShowWhy((v) => !v)}
                className="pop press shout w-full rounded-pill bg-panel px-4 py-2.5 text-label text-muted"
                aria-expanded={showWhy}
              >
                {showWhy ? "Hide" : "Why these numbers"}
              </button>

              <Collapse open={showWhy}>
                <div className="space-y-3 pt-1 text-xs leading-relaxed text-muted">
                  <p>
                    Every term above is an immutable set at deploy time, so no publisher can be
                    re-priced after the fact. A pin&rsquo;s bond is frozen when it is published;
                    changing the registry&rsquo;s prices later never touches an existing pin.
                  </p>
                  <p>
                    A challenger who proves equivocation keeps{" "}
                    {formatBps(pricing.challengerRewardBps)} of the slashed bond, which is what
                    makes watching for contradictions worth someone&rsquo;s gas. The remainder goes
                    to the slash recipient rather than being burned, so it can fund an insurance
                    pool later without a migration.
                  </p>
                  <p>
                    Bond becomes reclaimable {formatDuration(pricing.unbondingDelay)} after a pin is
                    revoked, and never while a contradiction about that version stands.
                  </p>
                  {/*
                    Moved here from beside the switch that controls it.

                    It is four lines about dimensional analysis, and it was sitting between the counters and the
                    diagram they drive -- pushing the thing that responds to those counters below the fold. It is
                    worth keeping and this is the panel for it: the question it answers is literally "why these
                    numbers".
                  */}
                  <p>
                    The native-value premium is flat rather than a share of the ceiling because bonds are
                    denominated in a six-decimal asset and ceilings in eighteen-decimal wei. Scaling one by the
                    other without a price oracle is dimensionally meaningless &mdash; an earlier version that
                    tried demanded about 1e19 units to pin a 10 MON ceiling.
                  </p>
                </div>
              </Collapse>
            </div>
          </Card>
        </Reveal>
      </div>

      <Section eyebrow="Registry parameters" title="As deployed">
        <RevealGroup className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <RevealItem>
            <Stat label="Base" value={formatBondWith(pricing, pricing.baseBond)} hint="Any publish" />
          </RevealItem>
          <RevealItem>
            <Stat
              label="Per capability"
              value={formatBondWith(pricing, pricing.perCapabilityBond)}
              hint="Each declared pair"
            />
          </RevealItem>
          <RevealItem>
            <Stat
              label="Per high risk"
              value={formatBondWith(pricing, pricing.highRiskBond)}
              hint="Allowance or transfer power"
              tone="attention"
            />
          </RevealItem>
          <RevealItem>
            <Stat
              label="Native value"
              value={formatBondWith(pricing, pricing.nativeValueBond)}
              hint="Flat, charged once"
              tone="attention"
            />
          </RevealItem>
        </RevealGroup>
      </Section>

      <Reveal>
        <Card className="bg-raise">
          <div className="flex flex-wrap items-center gap-3">
            <Pill tone="pinned">Why Monad</Pill>
            <p className="text-sm text-muted">
              Bond velocity. A shorter block time means collateral clears its unbonding window
              faster, so the same capital backs more version claims per week &mdash; and the hash
              check the guard performs on every call has to be cheap enough that nobody routes
              around it.
            </p>
          </div>
        </Card>
      </Reveal>
    </div>
  );
}

/**
 * One row of the pricing form: a name, a one-line reason, and whatever control sets it.
 *
 * Split out of `Counter`, which used to own both the row and the stepper inside it. The split is what let the
 * native-value switch join the same list instead of sitting in its own tinted box looking like a different
 * kind of thing -- and it is what keeps all three rows exactly the same height, which is most of why the card
 * now fits on one screen.
 *
 * The name is a `<span>`, not a `<label>`. It was a `<label>` with no `htmlFor` and no wrapped control,
 * because a stepper is two buttons and a readout rather than an input. A label that labels nothing is worse
 * than a span: it is announced as a form label, and clicking it does nothing when a reader reasonably expects
 * focus to move. The control names itself instead -- `role="group"` on the stepper, `aria-label` on the
 * switch -- and each button already carries its own "Decrease …" / "Increase …" name.
 */
function Control({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <span className="block text-note text-text">{label}</span>
        {/*
          One line each, kept short enough that it fits rather than relying on the clip.

          These were two- and four-line paragraphs. The longer of the two explanations moved into the "Why these
          numbers" panel beside this card; what is left here is the phrase a reader needs while their hand is on
          the control. `truncate` is the safety net for a narrow viewport, not the mechanism -- a hint that
          routinely ends in an ellipsis is information deleted quietly, so the copy is written to fit.
        */}
        <span className="mt-0.5 block truncate text-label leading-tight text-faint">{hint}</span>
      </div>
      {children}
    </div>
  );
}

/** A stepper. Chosen over a slider because these are small integers and exactness matters. */
function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex shrink-0 items-center gap-1 rounded-pill bg-raise p-1 chunk"
    >
      <Step label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
        &minus;
      </Step>
      <motion.span
        key={value}
        initial={{ opacity: 0.4, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={SPRING_FIRM}
        className="hash w-8 text-center text-sm text-text"
      >
        {value}
      </motion.span>
      <Step label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </Step>
    </div>
  );
}

function Step({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cx(
        "press grid size-8 place-items-center rounded-pill text-base font-extrabold",
        disabled
          ? "bg-raise-strong text-faint"
          : "pop-sm bg-bonded text-on-face [--pop:var(--bonded-shade)]",
      )}
    >
      {children}
    </button>
  );
}

/** A switch built on a real checkbox, so it is keyboard reachable and announces its state. */
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label className="relative inline-flex shrink-0 cursor-pointer items-center">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
        aria-label={label}
      />
      <span
        className={cx(
          "flex h-7 w-12 items-center rounded-pill p-1 transition-colors chunk",
          checked ? "bg-attention" : "bg-raise-strong",
        )}
      >
        <motion.span
          layout
          transition={SPRING_FIRM}
          className={cx("size-5 rounded-pill bg-text", checked ? "ml-auto" : "")}
        />
      </span>
    </label>
  );
}
