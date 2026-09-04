/**
 * Display helpers.
 *
 * Almost everything on screen is a 32-byte hash or a 20-byte address, so how those are
 * abbreviated is a real design decision rather than a detail. The rule here: always keep both
 * ends. A hash truncated to a prefix looks identical to a thousand others in the same demo,
 * and the whole point of the rug-pull view is that two hashes differ.
 */

// Imported from viem/utils rather than the package root. The root is a barrel that reaches the
// whole client and transport stack, which a formatting module has no business pulling in.
import { formatUnits } from "viem/utils";
import type { Address, Hex } from "viem";

/**
 * Shortens a hash keeping both ends.
 *
 * Twelve characters of a 66-character hash is enough for a human to tell two apart at a
 * glance while still fitting a table cell. Full values are always available on the element's
 * title and via copy.
 */
export function shortHash(value: Hex | string, lead = 6, tail = 4): string {
  if (value.length <= lead + tail + 2) return value;
  return `${value.slice(0, 2 + lead)}\u2026${value.slice(-tail)}`;
}

export function shortAddress(value: Address | string): string {
  return shortHash(value, 4, 4);
}

/**
 * Bond amounts, in the bond asset's own decimals.
 *
 * AUSD has six, not eighteen. Formatting a bond as ether understates it by a factor of a
 * trillion, which is exactly the kind of quiet wrongness that makes a dashboard untrustworthy,
 * so decimals are always passed in rather than defaulted.
 */
export function formatBond(amount: bigint, decimals: number, symbol?: string): string {
  const whole = formatUnits(amount, decimals);
  const trimmed = trimTrailingZeros(whole);
  return symbol === undefined ? trimmed : `${trimmed} ${symbol}`;
}

/** Native-value ceilings, which are wei and therefore eighteen decimals. */
export function formatNative(wei: bigint, symbol = "MON"): string {
  if (wei === 0n) return `no native value`;
  return `${trimTrailingZeros(formatUnits(wei, 18))} ${symbol}`;
}

function trimTrailingZeros(value: string): string {
  if (!value.includes(".")) return value;
  const trimmed = value.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "" ? "0" : trimmed;
}

/** Compact integers for stat tiles. */
export function formatCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${trimTrailingZeros((value / 1000).toFixed(1))}k`;
  return `${trimTrailingZeros((value / 1_000_000).toFixed(1))}M`;
}

/**
 * Relative time from a unix seconds timestamp.
 *
 * Rendered relative because "4 minutes ago" answers the question a reader has about a bond
 * window, where an absolute timestamp makes them do arithmetic.
 */
export function timeAgo(seconds: bigint, now: number = Date.now()): string {
  const then = Number(seconds) * 1000;
  const delta = Math.max(0, now - then);

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (delta < 45_000) return "just now";
  if (delta < hour) return `${Math.round(delta / minute)}m ago`;
  if (delta < day) return `${Math.round(delta / hour)}h ago`;
  if (delta < 30 * day) return `${Math.round(delta / day)}d ago`;
  return new Date(then).toISOString().slice(0, 10);
}

/** Basis points as a percentage, for the challenger's share of a slashed bond. */
export function formatBps(bps: bigint): string {
  return `${trimTrailingZeros((Number(bps) / 100).toFixed(2))}%`;
}

/** Seconds as a human duration, for the unbonding delay. */
export function formatDuration(seconds: bigint): string {
  const total = Number(seconds);
  if (total === 0) return "none";
  const day = 86_400;
  const hour = 3600;
  if (total % day === 0) return `${total / day}d`;
  if (total % hour === 0) return `${total / hour}h`;
  return `${Math.round(total / 60)}m`;
}

/**
 * How many leading hex characters two hashes share.
 *
 * Used to dim the common prefix of an approved hash and the hash on disk, so the eye lands on
 * the first character that actually differs instead of scanning 64 of them.
 */
export function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) i += 1;
  return i;
}
