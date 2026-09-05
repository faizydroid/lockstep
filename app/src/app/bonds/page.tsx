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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] 2xl:gap-8">
        <Reveal>
          <Card>
            <div className="space-y-6">
              <p className="shout text-label text-faint">
                Price a manifest
              </p>

              <Counter
                label="Declared capabilities"
                hint="Each distinct target and selector pair. Capped at 64 on chain, so a pin stays reviewable by a human."
                value={capabilities}
                min={1}
                max={12}
                onChange={(next) => {
                  setCapabilities(next);
                  if (highRisk > next) setHighRisk(next);
                }}
              />

              <Counter
                label="Of which high risk"
                hint="approve, transfer, setApprovalForAll, permit, delegate, upgradeTo and the rest of the twelve."
                value={effectiveHighRisk}
                min={0}
                max={capabilities}
                onChange={setHighRisk}
              />

              {/*
                The shape the price is charged for, drawn from the same counters.
                
                This page's whole claim is that the bond tracks blast radius rather than value moved.
                Two number inputs and a total do not show that; watching the constellation sprawl as
                you add powers, and the figure climb with it, is the argument itself. Same component
                as the pin detail view, so what a publisher previews here is what a reviewer will see.
              */}
              <div className="rounded-xl bg-sunken p-4 chunk">
                <CapabilityConstellation
                  capabilities={preview}
                  movesNativeValue={movesNative}
                />
              </div>

              <div className="flex items-start justify-between gap-4 rounded-xl bg-raise p-4 chunk">
                <div className="space-y-1">
                  <p className="text-sm text-text">Can move native value</p>
                  <p className="max-w-sm text-xs leading-relaxed text-faint">
                    A flat charge rather than a share of the ceiling. Bonds are denominated in a
                    six-decimal asset and ceilings in eighteen-decimal wei; scaling one by the
                    other without a price oracle is dimensionally meaningless, and an earlier
                    version that tried demanded about 1e19 units to pin a 10 MON ceiling.
                  </p>
                </div>
                <Toggle checked={movesNative} onChange={setMovesNative} label="Can move native value" />
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

/** A stepper. Chosen over a slider because these are small integers and exactness matters. */
function Counter({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        {/*
          A `<span>`, not a `<label>`.

          It was a `<label>` with no `htmlFor` and no wrapped control, because the stepper is two buttons and
          a readout rather than an input. A label that labels nothing is worse than a span: it is announced as
          a form label, and clicking it does nothing when a reader reasonably expects focus to move.

          The group gets the name instead, via `role="group"` and `aria-label`, and each button already
          carries its own "Decrease …" / "Increase …" name.
        */}
        <span className="text-note text-text">{label}</span>
        <div
          role="group"
          aria-label={label}
          className="flex items-center gap-1 rounded-pill bg-raise p-1 chunk"
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
      </div>
      <p className="max-w-md text-xs leading-relaxed text-faint">{hint}</p>
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
