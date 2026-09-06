import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * What the dashboard says while it does not know yet, and whether colour is ever the only thing saying it.
 *
 * The first half of this file exists because of a defect I shipped. `decisionsFor` runs against whatever
 * snapshot is mounted, and the provider seeds a fixture so every page has a shape to render -- a fixture that
 * contains a widening drift. So for the duration of every chain read, the `h1` on the dashboard read
 * "2 things need your decision", about somebody else's sample data, on the account owner's own page.
 *
 * A caption was not enough, which was the earlier lesson learned only halfway: a cell labelled "· reading" was
 * still printing a sample number, and a reader cannot tell a placeholder number from a real one. So the values
 * wait and the labels stay, because a label is a static truth about what a figure will be.
 */

import { countNewSince } from "@/components/activity";
import { parse, serialise, DEFAULT_SETTINGS } from "@/lib/settings";

const APP = join(import.meta.dirname, "..", "src");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const ui = readFileSync(join(APP, "components", "ui.tsx"), "utf8");
const verdict = readFileSync(join(APP, "components", "verdict.tsx"), "utf8");
const activity = readFileSync(join(APP, "components", "activity.tsx"), "utf8");
const nav = readFileSync(join(APP, "components", "nav.tsx"), "utf8");
const dashboard = readFileSync(join(APP, "app", "dashboard", "page.tsx"), "utf8");
const css = readFileSync(join(APP, "app", "globals.css"), "utf8");

describe("nothing claims a fact it has not read", () => {
  it("replaces the verdict while the read is in flight", () => {
    /*
     * The defect named above. A false positive on a security tool is worse than a slow one, and the
     * `h1` is the single most prominent claim in the product.
     */
    expect(verdict).toMatch(/if \(certainty === "reading"\) return <VerdictReading \/>/);
    expect(verdict).toMatch(/Reading the registry\./);
  });

  it("replaces the ratio tiles too", () => {
    // An 80% integrity ring drawn from a fixture is a specific, memorable, wrong number about the reader's own
    // account.
    expect(verdict).toMatch(/if \(certainty === "reading"\) return <PositionReading \/>/);
  });

  it("replaces the activity rows, which are the record", () => {
    /*
     * Arguably the worst shape of the same bug. An audit feed is the surface a reader trusts to be a record;
     * four sample executions attributed to a sample executor teach exactly the wrong lesson about how much of
     * this page is real.
     */
    const guard = /if \(certainty === "reading"\) \{[\s\S]*?\n  \}/.exec(activity)?.[0] ?? "";
    expect(guard, "the activity feed has no reading state").not.toBe("");
    expect(guard).toMatch(/<Skeleton/);
  });

  it("replaces the registry figures rather than captioning them", () => {
    /*
     * The earlier fix was a "· reading" suffix beside the fixture's number, which is a label admitting the
     * value might be wrong while still printing it. The label above each cell stays -- it names what the cell
     * counts, which is true either way.
     */
    expect(dashboard).toMatch(/reading \? \(\s*<Skeleton/);
    expect(stripComments(dashboard), "the reading caption is back beside a sample figure").not.toMatch(
      /reading \? \(\s*<span className="text-muted"> &middot; reading/,
    );
  });

  it("does not report a read in flight on a build that will never read", () => {
    /*
     * The other half of the same honesty rule, found by the export check rather than by reasoning.
     *
     * The registry address is inlined at build time and cannot be changed by a setting. So when it is absent,
     * the outcome is decided before anyone looks: there is nothing to read and there never will be. Reporting
     * "reading" there meant every placeholder above would be held forever on a build with no deployment --
     * while the sample figures such a build shows are correct, complete and already labelled as examples.
     *
     * It also decides what the exported HTML of a sample build contains: data, rather than a page of boxes.
     */
    const data = readFileSync(join(APP, "components", "data.tsx"), "utf8");
    const fn = /export function useCertainty\(\)[\s\S]*?\n}/.exec(data)?.[0] ?? "";

    expect(fn, "useCertainty was not found").not.toBe("");
    expect(fn).toMatch(/if \(readConfig\(\)\.registry === undefined\) return "sample"/);

    // And that check has to come first, or `status === "loading"` claims a read before it is reached.
    const guard = fn.indexOf("readConfig().registry === undefined");
    const loading = fn.indexOf('status === "loading"');
    expect(guard, "the no-registry guard is missing").toBeGreaterThan(-1);
    expect(loading, "the loading branch is missing").toBeGreaterThan(-1);
    expect(guard, "the loading branch runs before the no-registry guard").toBeLessThan(loading);
  });

  it("narrows on certainty rather than on the source kind", () => {
    /*
     * This is why `useCertainty` exists and it is easy to "simplify" back. `source.kind` is still `sample`
     * during a read, so keying these branches off it would make them permanent on a build with no registry
     * configured -- where the sample figures are correct and already labelled as such.
     */
    for (const [name, source] of [
      ["verdict", verdict],
      ["activity", activity],
    ] as const) {
      expect(stripComments(source), `${name} branches on source.kind`).not.toMatch(/source\.kind === "sample"/);
    }
  });

  it("tells assistive technology the region is working", () => {
    // A spinner announces nothing. `aria-busy` is what makes "this is loading" audible, and it has to come off
    // again when the read lands.
    expect(verdict).toMatch(/aria-busy="true"/);
    expect(activity).toMatch(/aria-busy="true"/);
    expect(dashboard).toMatch(/aria-busy=\{reading \? "true" : undefined\}/);
  });
});

describe("the skeleton", () => {
  it("does not animate", () => {
    /*
     * Skeletons beat spinners because they communicate structure before content, not because they move. This
     * app renders a static dot grid and refuses decorative motion elsewhere; a row of pulsing bars under a
     * table of hashes would be the loudest thing on the page while saying nothing.
     */
    const fn = /export function Skeleton\([\s\S]*?\n}/.exec(ui)?.[0] ?? "";
    expect(fn, "the Skeleton primitive was not found").not.toBe("");
    expect(fn, "the skeleton animates").not.toMatch(/animate-|motion\./);
  });

  it("is hidden from assistive technology", () => {
    // The region's `aria-busy` is the announcement. A screen reader reading out four empty boxes is noise.
    const fn = /export function Skeleton\([\s\S]*?\n}/.exec(ui)?.[0] ?? "";
    expect(fn).toMatch(/aria-hidden/);
  });

  it("matches the ring's diameter where it stands in for one", () => {
    // A placeholder smaller than what replaces it lets the tile grow when the read lands, which is the jump a
    // skeleton exists to prevent.
    expect(verdict).toMatch(/size-\[104px\]/);
    expect(verdict, "the ring size and the placeholder no longer agree").toMatch(/size=\{104\}/);
  });
});

describe("tabular figures are set once", () => {
  it("lives in globals.css and not on individual figures", () => {
    /*
     * Every number in this app is meant to be comparable down a column, so the property belongs on `html`
     * where it is inherited. It was already there, which made the `tabular-nums` classes added alongside the
     * new dashboard redundant -- and a redundant class is the kind of thing that gets copied to the next
     * figure and then looks load-bearing.
     */
    expect(css).toMatch(/font-variant-numeric: tabular-nums/);
    /*
     * Stripped, because both files explain in a comment why the class is absent, and an unstripped assertion
     * matches the explanation. This is the eighth time a test in this repo has failed against its own
     * documentation; every assertion of absence has to strip first.
     */
    expect(stripComments(verdict), "a redundant tabular-nums class is back").not.toMatch(/\btabular-nums\b/);
    expect(stripComments(dashboard), "a redundant tabular-nums class is back").not.toMatch(/\btabular-nums\b/);
  });
});

describe("colour is never the only carrier", () => {
  it("pairs the queue's severity hue with a word", () => {
    expect(verdict).toMatch(/KIND_LABEL\[decision\.kind\]/);
  });

  it("pairs the network chip's dot with the state in text", () => {
    /*
     * The dot was doing the whole job: green read, blue reading, amber sample. A reader who cannot distinguish
     * those hues saw one chip that never changed -- and this is not decoration, it is whether the figures on
     * the page are a reading of a deployment or a worked example. The `title` carried it, which is a hover,
     * which is not an answer on a phone.
     */
    const chip = /function NetworkChip\(\)[\s\S]*?\n}/.exec(nav)?.[0] ?? "";
    expect(chip, "NetworkChip was not found").not.toBe("");
    expect(chip).toMatch(/certainty === "reading" \? "reading" : "sample"/);
  });

  it("pairs the feed's new marker with a word", () => {
    // A tinted row or a coloured dot would be invisible to a reader who cannot see it, and this marker is the
    // difference between an event they have reviewed and one they have not.
    expect(activity).toMatch(/<Pill tone="pinned">new<\/Pill>/);
  });
});

describe("new since you last looked", () => {
  it("claims nothing without a baseline", () => {
    /*
     * A reader on their first visit has not failed to notice anything. Returning `events.length` here would be
     * a notification about nothing, which is the version of this feature that trains people to ignore the
     * marker.
     */
    expect(countNewSince([{ at: 100n }, { at: 200n }], undefined)).toBe(0);
  });

  it("counts strictly after the baseline", () => {
    expect(countNewSince([{ at: 100n }, { at: 200n }, { at: 300n }], 200)).toBe(1);
    expect(countNewSince([{ at: 100n }], 100)).toBe(0);
    expect(countNewSince([{ at: 100n }], 0)).toBe(1);
  });

  it("survives a baseline in the future", () => {
    // Clock skew, or a settings entry copied between machines. Nothing new is the right answer, not a negative.
    expect(countNewSince([{ at: 100n }], 9_999_999_999)).toBe(0);
  });

  it("captures the baseline before recording the visit", () => {
    /*
     * The whole trick, and it inverts if the two effects are reordered: what the reader is shown must be the
     * moment before they arrived, not the moment they arrived, which would always be zero.
     */
    const hook = /function useLastSeen\(\)[\s\S]*?\n}/.exec(activity)?.[0] ?? "";
    expect(hook, "useLastSeen was not found").not.toBe("");
    expect(hook).toMatch(/captured\.current/);
    expect(hook, "the baseline is recorded during a read or off a fixture").toMatch(
      /certainty !== "chain"\) return/,
    );
  });

  it("persists the baseline, and refuses a nonsense one", () => {
    expect(parse(serialise({ ...DEFAULT_SETTINGS, lastSeenAt: 1700000000 })).lastSeenAt).toBe(1700000000);
    expect(parse(JSON.stringify({ lastSeenAt: -1 })).lastSeenAt).toBeUndefined();
    expect(parse(JSON.stringify({ lastSeenAt: "yesterday" })).lastSeenAt).toBeUndefined();
    // NaN and the infinities survive a JSON round trip as `null`, but a hand-edited entry can carry them.
    expect(parse('{"lastSeenAt":null}').lastSeenAt).toBeUndefined();
  });

  it("omits the baseline entirely on a first visit", () => {
    // Absent has to stay distinguishable from zero: zero would mark every event ever recorded as new.
    const written = JSON.parse(serialise(DEFAULT_SETTINGS)) as Record<string, unknown>;
    expect("lastSeenAt" in written).toBe(false);
  });
});
