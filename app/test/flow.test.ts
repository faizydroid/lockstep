import { describe, expect, it } from "vitest";

import { FLOW_ROUTES, STAGE_ROUTE, redirectFor, stageFor } from "../src/lib/flow";
import { DEFAULT_SETTINGS, isAllowedDisplayName, parse, serialise } from "../src/lib/settings";
import type { Profile } from "../src/lib/settings";

/**
 * The first-run flow: landing, profile, onboarding, dashboard.
 *
 * Most of these assertions are about the order of the checks in `stageFor`, because a plain cascade gets
 * two cases wrong and both are the kind that only show up in someone else's browser: a returning reader
 * thrown back to the marketing page because their wallet locked, and a reader who chose to look around
 * being re-asked on every navigation.
 */

const PROFILE: Profile = { displayName: "Ada", role: "owner" };

/** A first-time reader with nothing stored and nothing connected. */
const FRESH = {
  connected: false,
  profile: undefined,
  onboardingAcknowledged: false,
  skippedSetup: false,
} as const;

describe("stageFor", () => {
  it("starts a first-time reader on the landing page", () => {
    expect(stageFor(FRESH)).toBe("landing");
  });

  it("advances to the profile step once a wallet is connected", () => {
    expect(stageFor({ ...FRESH, connected: true })).toBe("profile");
  });

  it("advances to onboarding once a profile exists", () => {
    expect(stageFor({ ...FRESH, connected: true, profile: PROFILE })).toBe("onboarding");
  });

  it("reaches the dashboard once onboarding is acknowledged", () => {
    const done = { ...FRESH, connected: true, profile: PROFILE, onboardingAcknowledged: true };
    expect(stageFor(done)).toBe("ready");
  });

  it("keeps a finished reader finished when the wallet disconnects", () => {
    /*
     * The case a plain cascade gets wrong. Checking `connected` first would demote someone with a saved
     * profile back to the landing page every time their wallet locked itself, and the profile that made
     * them a returning reader is still sitting there.
     */
    const returning = { ...FRESH, connected: false, profile: PROFILE, onboardingAcknowledged: true };
    expect(stageFor(returning)).toBe("ready");
  });

  it("treats a skip as durable rather than per-visit", () => {
    expect(stageFor({ ...FRESH, skippedSetup: true })).toBe("ready");
    // Still durable after connecting: the flow stops steering, it does not resume.
    expect(stageFor({ ...FRESH, skippedSetup: true, connected: true })).toBe("ready");
  });

  it("does not treat a half-finished profile as finished", () => {
    // Profile without acknowledgement is still mid-flow, which is what keeps onboarding from being
    // skipped by anyone who filled in a name and navigated away.
    expect(stageFor({ ...FRESH, connected: true, profile: PROFILE })).not.toBe("ready");
    expect(stageFor({ ...FRESH, connected: true, onboardingAcknowledged: true })).not.toBe("ready");
  });
});

describe("redirectFor", () => {
  it("steers a mid-flow reader off a product page back to their stage", () => {
    expect(redirectFor("profile", "/dashboard")).toBe(STAGE_ROUTE.profile);
    expect(redirectFor("onboarding", "/pins")).toBe(STAGE_ROUTE.onboarding);
    expect(redirectFor("landing", "/bonds")).toBe("/");
  });

  it("leaves a reader alone when they are already on their stage", () => {
    // Otherwise the router loops: redirect to the page you are on, re-render, redirect again.
    expect(redirectFor("profile", STAGE_ROUTE.profile)).toBeUndefined();
    expect(redirectFor("onboarding", STAGE_ROUTE.onboarding)).toBeUndefined();
    expect(redirectFor("landing", "/")).toBeUndefined();
  });

  it("pushes a finished reader off the stage pages", () => {
    // A profile form that reappears after it is filled in reads as though the save failed.
    expect(redirectFor("ready", STAGE_ROUTE.profile)).toBe("/dashboard");
    expect(redirectFor("ready", STAGE_ROUTE.onboarding)).toBe("/dashboard");
  });

  it("lets a finished reader read the landing page", () => {
    // It is a real page with a real argument on it, not a turnstile.
    expect(redirectFor("ready", "/")).toBeUndefined();
  });

  it("leaves a finished reader on any product page", () => {
    for (const path of ["/dashboard", "/pins", "/drift", "/account", "/badge"]) {
      expect(redirectFor("ready", path), path).toBeUndefined();
    }
  });

  it("never redirects to a route outside the flow", () => {
    for (const stage of ["landing", "profile", "onboarding"] as const) {
      const target = redirectFor(stage, "/somewhere-else");
      expect(FLOW_ROUTES, `${stage} -> ${target}`).toContain(target);
    }
  });
});

describe("the stored profile", () => {
  it("is absent by default, so a fresh reader is not treated as returning", () => {
    expect(DEFAULT_SETTINGS.profile).toBeUndefined();
    expect(DEFAULT_SETTINGS.onboardingAcknowledged).toBe(false);
    expect(DEFAULT_SETTINGS.skippedSetup).toBe(false);
  });

  it("survives a round trip", () => {
    const stored = serialise({ ...DEFAULT_SETTINGS, profile: { displayName: "Ada", role: "publisher", org: "Kuru" } });
    expect(parse(stored).profile).toEqual({ displayName: "Ada", role: "publisher", org: "Kuru" });
  });

  it("drops the whole profile when the display name is unusable", () => {
    /*
     * Dropped rather than defaulted, and the reason is the flow: a profile is what decides whether the
     * first run is finished, so a half-parsed one would put a reader on the dashboard having never been
     * asked anything.
     */
    for (const displayName of ["", "   ", 42, null, undefined]) {
      const raw = JSON.stringify({ profile: { displayName, role: "owner" } });
      expect(parse(raw).profile, JSON.stringify(displayName)).toBeUndefined();
    }
  });

  it("drops a profile with a role outside the closed set", () => {
    const raw = JSON.stringify({ profile: { displayName: "Ada", role: "administrator" } });
    expect(parse(raw).profile).toBeUndefined();
  });

  it("bounds the stored strings on the way in, not only on the way out", () => {
    const raw = JSON.stringify({
      profile: { displayName: "a".repeat(500), role: "owner", org: "b".repeat(500) },
    });
    const profile = parse(raw).profile;
    expect(profile?.displayName).toHaveLength(48);
    expect(profile?.org).toHaveLength(48);
  });

  it("treats a blank org as absent rather than as an empty string", () => {
    const raw = JSON.stringify({ profile: { displayName: "Ada", role: "owner", org: "   " } });
    expect(parse(raw).profile).toEqual({ displayName: "Ada", role: "owner" });
  });

  it("never throws on hostile storage", () => {
    for (const raw of ["null", "[]", '{"profile":"nope"}', '{"profile":[]}', "{", '{"profile":{}}']) {
      expect(() => parse(raw), raw).not.toThrow();
    }
  });

  it("collects no contact field, because there is nowhere to send to", () => {
    // A static export has no server. An email box here would be the clearest possible lie.
    const stored = serialise({ ...DEFAULT_SETTINGS, profile: PROFILE });
    expect(stored).not.toMatch(/email|phone|contact/i);
  });
});

describe("isAllowedDisplayName", () => {
  it("accepts an ordinary name and rejects blank", () => {
    expect(isAllowedDisplayName("Ada")).toBe(true);
    expect(isAllowedDisplayName("")).toBe(false);
    expect(isAllowedDisplayName("   ")).toBe(false);
  });

  it("agrees with the parser about the bound", () => {
    expect(isAllowedDisplayName("a".repeat(48))).toBe(true);
    expect(isAllowedDisplayName("a".repeat(49))).toBe(false);
  });
});
