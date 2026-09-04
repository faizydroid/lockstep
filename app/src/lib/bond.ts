/**
 * Bond arithmetic. Pure, and deliberately kept away from the chain client.
 *
 * These two functions started out in chain.ts, which imports createPublicClient and the chain
 * definitions. Nothing here needs any of that, but importing one pure function pulled the whole
 * transport stack into the test graph and took module collection from under a second to over
 * five minutes. Splitting them is not tidiness; it is the difference between a test suite
 * someone runs on every change and one they avoid.
 */

import { formatUnits } from "viem/utils";

import type { BondPricing, Pin } from "./model";

export interface BondPart {
  readonly label: string;
  readonly amount: bigint;
  /** Plain-language reason this term exists, shown next to the figure. */
  readonly detail: string;
}

export interface BondBreakdown {
  readonly parts: readonly BondPart[];
  readonly total: bigint;
  /**
   * Whether the recomputed total equals the bond actually recorded against the pin.
   *
   * A pin's bond is frozen at publish time, so the registry's current prices can legitimately
   * differ from what this pin was charged. The UI needs to be able to notice that and say so,
   * rather than presenting a breakdown that quietly disagrees with the total beside it.
   */
  readonly matchesChain: boolean;
}

/**
 * Recomputes a pin's bond from the registry's published prices.
 *
 * Mirrors `PinRegistry.quoteBond` exactly:
 *   base + perCapability * count + highRisk * highRiskCount + (movesNativeValue ? native : 0)
 */
export function bondBreakdown(pin: Pin, pricing: BondPricing): BondBreakdown {
  const capabilityCount = pin.capabilities.length;
  const highRiskCount = pin.capabilities.filter((c) => c.highRisk).length;
  const movesNative = pin.maxValuePerCall > 0n;

  const parts: BondPart[] = [
    { label: "base", amount: pricing.baseBond, detail: "charged on any publish" },
    {
      label: `${capabilityCount} capabilit${capabilityCount === 1 ? "y" : "ies"}`,
      amount: pricing.perCapabilityBond * BigInt(capabilityCount),
      detail: "breadth of what it may call",
    },
  ];

  if (highRiskCount > 0) {
    parts.push({
      label: `${highRiskCount} high risk`,
      amount: pricing.highRiskBond * BigInt(highRiskCount),
      detail: "can grant allowances or move tokens",
    });
  }

  if (movesNative) {
    parts.push({
      label: "native value",
      amount: pricing.nativeValueBond,
      detail: "flat premium for being able to move native value at all",
    });
  }

  const total = parts.reduce((sum, part) => sum + part.amount, 0n);
  return { parts, total, matchesChain: total === pin.requiredBond };
}

/** Formats an amount in the bond asset's own decimals, which are six rather than eighteen. */
export function formatBondWith(pricing: BondPricing, amount: bigint): string {
  return `${formatUnits(amount, pricing.bondAssetDecimals)} ${pricing.bondAssetSymbol}`;
}
