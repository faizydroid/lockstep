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

/**
 * What the reader came here as.
 *
 * A closed set rather than a free-text field, for two reasons. It is the one profile answer that can
 * actually change what the onboarding shows -- an account owner needs approvals and enforcement, a
 * publisher needs bonds and the badge -- so it earns its place instead of being a form for its own sake.
 * And a closed set means no unbounded attacker-controlled string enters storage at all, which is one
 * fewer thing for `displayName` to have to clean up later.
 */
export const PROFILE_ROLES = ["owner", "publisher", "reviewer", "looking"] as const;

export type ProfileRole = (typeof PROFILE_ROLES)[number];

/**
 * A local label for whoever is reading, and nothing more than that.
 *
 * ## Why this is not an account
 *
 * There is no server. `next.config.ts` sets `output: "export"`, so the whole app is a static bundle and
 * there is nowhere for a profile to be sent. Everything here lives in this browser's `localStorage`,
 * survives nothing but this browser, and authenticates nobody.
 *
 * That is worth being blunt about in the type rather than only in the UI, because the shape of this
 * object invites the wrong assumption. A field called `email` would be the clearest possible example of
 * the lie -- collecting an address with no way to send to it -- so there is deliberately no contact
 * field of any kind. What is here is a name to greet someone by and a role that changes what they are
 * shown first.
 */
export interface Profile {
  /** What to call the reader. Bounded, and cleaned again by `displayName` on the way to the screen. */
  readonly displayName: string;
  readonly role: ProfileRole;
  /** Optional team or project name. Same treatment as the display name. */
  readonly org?: string;
}

/** Bounds on the two free-text profile fields, applied on the way in as well as on the way out. */
const PROFILE_NAME_MAX = 48;

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
  /** The local label from the first-run flow, absent until the reader fills it in. */
  readonly profile?: Profile;
  /**
   * Set when the reader has been through the onboarding stage and moved on.
   *
   * Separate from `quickstartDismissed`, which is about the panel on the dashboard. This one is about
   * the stage in the first-run flow, and conflating them would mean dismissing a panel could silently
   * re-run someone's onboarding or skip it.
   */
  readonly onboardingAcknowledged: boolean;
  /**
   * Set when the reader chose to look around without connecting anything.
   *
   * This exists because the alternative is a login wall, and a login wall is the wrong default for this
   * product specifically: the first screen's whole job is to make an argument to a sceptic, and a
   * sceptic who cannot see the argument without producing a wallet leaves. It is persisted so the choice
   * is not re-asked on every navigation.
   */
  readonly skippedSetup: boolean;
  /**
   * Whether the left navigation rail shows its labels.
   *
   * A layout preference rather than a piece of product state, and it is stored for one specific reason:
   * the reader who collapses it is the reader looking at `/pins` or `/publishers`, which are wide tables,
   * and re-expanding the rail on every navigation would undo the choice they just made about their own
   * screen.
   *
   * Defaults to expanded, and `parse` reads it as `!== false` rather than `=== true` so an entry written
   * before this field existed keeps the default instead of silently collapsing.
   */
  readonly navExpanded: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  motion: "system",
  completedSteps: [],
  quickstartDismissed: false,
  onboardingAcknowledged: false,
  skippedSetup: false,
  navExpanded: true,
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
 * A profile out of storage, or undefined.
 *
 * Follows this file's rule rather than inventing a new one: every field is checked, and anything that
 * does not validate is dropped. A missing or unusable display name drops the whole profile rather than
 * substituting a placeholder, because a profile is what decides whether the first-run flow is finished
 * -- a half-parsed one would put a reader into the dashboard having never been asked.
 *
 * The strings are trimmed and cut here, on the way in. `displayName` cleans them again on the way to the
 * screen, and the duplication is deliberate: this bounds what is stored, that bounds what is rendered,
 * and neither should assume the other ran.
 */
function parseProfile(value: unknown): Profile | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;

  if (typeof record.displayName !== "string") return undefined;
  const displayName = record.displayName.trim().slice(0, PROFILE_NAME_MAX);
  if (displayName === "") return undefined;

  const role = PROFILE_ROLES.find((r) => r === record.role);
  if (role === undefined) return undefined;

  const rawOrg = typeof record.org === "string" ? record.org.trim().slice(0, PROFILE_NAME_MAX) : "";

  return { displayName, role, ...(rawOrg === "" ? {} : { org: rawOrg }) };
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

  const profile = parseProfile(record.profile);

  return {
    motion: parseMotion(record.motion),
    completedSteps: parseSteps(record.completedSteps),
    quickstartDismissed: record.quickstartDismissed === true,
    onboardingAcknowledged: record.onboardingAcknowledged === true,
    skippedSetup: record.skippedSetup === true,
    /*
     * `!== false`, not `=== true`, and this is the one field where that asymmetry is correct.
     *
     * Every other boolean here defaults to false, so reading an absent key as false is the same as the
     * default. This one defaults to true. Written as `=== true` it would collapse the rail for every
     * reader who already has a settings entry -- which is every returning reader -- on the first load
     * after deploy, for no reason they could connect to anything they did.
     */
    navExpanded: record.navExpanded !== false,
    ...(rpcUrl === undefined ? {} : { rpcUrl }),
    ...(account === undefined ? {} : { account }),
    ...(deployBlock === undefined ? {} : { deployBlock }),
    ...(profile === undefined ? {} : { profile }),
  };
}

/** Serialises to JSON. `bigint` has no JSON form, so `deployBlock` goes out as a decimal string. */
export function serialise(settings: Settings): string {
  return JSON.stringify({
    motion: settings.motion,
    completedSteps: settings.completedSteps,
    quickstartDismissed: settings.quickstartDismissed,
    onboardingAcknowledged: settings.onboardingAcknowledged,
    skippedSetup: settings.skippedSetup,
    navExpanded: settings.navExpanded,
    ...(settings.rpcUrl === undefined ? {} : { rpcUrl: settings.rpcUrl }),
    ...(settings.account === undefined ? {} : { account: settings.account }),
    ...(settings.deployBlock === undefined ? {} : { deployBlock: settings.deployBlock.toString() }),
    ...(settings.profile === undefined ? {} : { profile: settings.profile }),
  });
}

/** Whether a display name is usable. Same bound the parser applies, exposed for the form. */
export function isAllowedDisplayName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= PROFILE_NAME_MAX;
}

/** The bound, exported so the form's `maxLength` and the parser cannot drift apart. */
export const DISPLAY_NAME_MAX = PROFILE_NAME_MAX;

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
