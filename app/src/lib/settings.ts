/**
 * Client-side settings, and the rules about what a setting is allowed to change.
 *
 * ## The rule
 *
 * This app's whole subject is the difference between a claim and a reading. A settings panel is a
 * place where that distinction is easy to lose, because every setting is a way for the viewer to
 * change what the interface says. So there is one rule, and it is narrower than "validate the input":
 *
 * > A setting may change **what** the dashboard reads or **how** it is presented. It may not change
 * > what the dashboard *claims* about a reading without disclosing that it was changed.
 *
 * That rule is what admits an RPC override and rejects a registry override. See `PIN_REGISTRY_IS_FIXED`
 * below, which exists to hold that decision rather than leave it to memory.
 *
 * ## Storage is untrusted input
 *
 * `localStorage` is readable and writable by any script that reaches this origin, which means it has
 * exactly the trust level of a URL query string. Anything parsed out of it is validated field by field
 * and a bad field is dropped rather than throwing, because a corrupt entry must degrade to defaults
 * instead of breaking every page. `parse` is pure and exported so the suite can hit it with hostile
 * input directly.
 */

import type { Address } from "viem";

/**
 * The registry address is deliberately not settable.
 *
 * Every other value here is transport or presentation. The registry is the one value that determines
 * whether anything on screen is about Lockstep at all, and a panel that can repoint it turns this
 * dashboard into a convenient way to produce authoritative-looking screenshots of a registry that is
 * not this one. It stays a build-time constant, where changing it requires a rebuild and leaves a
 * trace.
 */
export const PIN_REGISTRY_IS_FIXED = true;

export type MotionPreference = "system" | "reduced" | "full";

export interface Settings {
  /**
   * Transport override. The chain is still verified, and an override is disclosed in the source banner.
   *
   * Allowed because Monad's public endpoint rate-limits hard enough that a real reader needs their own,
   * and because it cannot silently change what is claimed: `readChain` reports the chain id it actually
   * got, and the banner names the host when it is not the default.
   */
  readonly rpcUrl?: string;
  /** Whose approvals and executions to show. Read-only, and the address is on screen throughout. */
  readonly account?: Address;
  /** Where log scanning starts. Wrong values cost completeness, which the reader is told about. */
  readonly deployBlock?: bigint;
  readonly motion: MotionPreference;
  /** Ids of onboarding steps the viewer has finished. */
  readonly completedSteps: readonly string[];
  /** Set once the quickstart has been dismissed, so it does not return on every visit. */
  readonly quickstartDismissed: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  motion: "system",
  completedSteps: [],
  quickstartDismissed: false,
};

export const STORAGE_KEY = "lockstep.settings.v1";

/**
 * Accepts an https origin, or http only on a loopback host.
 *
 * Three things are being refused here, and only the first is obvious. A non-http scheme, because
 * `javascript:` and `data:` in a field that later reaches a fetch is a scripting bug waiting for a
 * careless refactor. Plain http on a public host, because the page is served over https and the
 * browser will block it anyway — better to refuse it in the field with a reason than to accept it and
 * fail opaquely later. And anything with credentials in it, because `https://user:pass@host` in
 * localStorage is a way to leak a key into a place nobody thinks to clear.
 */
export function isAllowedRpcUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.username !== "" || url.password !== "") return false;

  if (url.protocol === "https:") return true;

  if (url.protocol === "http:") {
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  }

  return false;
}

/** A configured-but-zero address is the same as unconfigured, and is a common mistake. */
export function isAllowedAddress(value: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return false;
  return value.toLowerCase() !== "0x0000000000000000000000000000000000000000";
}

function parseBlock(value: unknown): bigint | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  try {
    const n = BigInt(value);
    return n < 0n ? undefined : n;
  } catch {
    return undefined;
  }
}

function parseMotion(value: unknown): MotionPreference {
  return value === "reduced" || value === "full" ? value : "system";
}

/**
 * Step ids, bounded on both count and length.
 *
 * Not paranoia about a hostile actor so much as about an unbounded write: this array is persisted and
 * rendered, and without a cap a loop that pushed on every render would grow localStorage until the
 * quota threw somewhere unrelated. Ids are matched against a pattern rather than accepted as any
 * string, so nothing arbitrary from storage ever reaches the DOM.
 */
const MAX_STEPS = 32;
const STEP_ID = /^[a-z0-9-]{1,40}$/;

function parseSteps(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !STEP_ID.test(entry)) continue;
    if (out.includes(entry)) continue;
    out.push(entry);
    if (out.length >= MAX_STEPS) break;
  }
  return out;
}

/**
 * Parses stored settings, dropping anything that does not validate.
 *
 * Never throws and never returns a partially-valid field. A caller gets defaults plus whatever
 * survived, which is the only behaviour that keeps a corrupt entry from taking down every page.
 */
export function parse(raw: string | null): Settings {
  if (raw === null || raw === "") return DEFAULT_SETTINGS;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_SETTINGS;
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) return DEFAULT_SETTINGS;
  const record = value as Record<string, unknown>;

  const rpcUrl = typeof record.rpcUrl === "string" && isAllowedRpcUrl(record.rpcUrl) ? record.rpcUrl : undefined;
  const account =
    typeof record.account === "string" && isAllowedAddress(record.account)
      ? (record.account as Address)
      : undefined;
  const deployBlock = parseBlock(record.deployBlock);

  return {
    motion: parseMotion(record.motion),
    completedSteps: parseSteps(record.completedSteps),
    quickstartDismissed: record.quickstartDismissed === true,
    ...(rpcUrl === undefined ? {} : { rpcUrl }),
    ...(account === undefined ? {} : { account }),
    ...(deployBlock === undefined ? {} : { deployBlock }),
  };
}

/** Serialises to JSON. `bigint` has no JSON form, so `deployBlock` goes out as a decimal string. */
export function serialise(settings: Settings): string {
  return JSON.stringify({
    motion: settings.motion,
    completedSteps: settings.completedSteps,
    quickstartDismissed: settings.quickstartDismissed,
    ...(settings.rpcUrl === undefined ? {} : { rpcUrl: settings.rpcUrl }),
    ...(settings.account === undefined ? {} : { account: settings.account }),
    ...(settings.deployBlock === undefined ? {} : { deployBlock: settings.deployBlock.toString() }),
  });
}

/** True when any setting differs from the build's own configuration. Drives the banner's disclosure. */
export function isOverridden(settings: Settings): boolean {
  return (
    settings.rpcUrl !== undefined ||
    settings.account !== undefined ||
    settings.deployBlock !== undefined
  );
}

/**
 * Host of an overridden RPC, for display.
 *
 * The host and not the full URL: a self-hosted endpoint routinely carries an API key in its path or
 * query, and this string goes on screen on every page. Disclosing that an override is in effect does
 * not require disclosing the key.
 */
export function rpcHost(settings: Settings): string | undefined {
  if (settings.rpcUrl === undefined) return undefined;
  try {
    return new URL(settings.rpcUrl).host;
  } catch {
    return undefined;
  }
}
