import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The dashboard's ranking, and the record under it.
 *
 * The queue decides what the most prominent sentence on the most-visited page says, so the ranking is tested
 * rather than trusted. The cases that matter are the ones where two problems are present and only one can
 * lead, and the one where a change is real but needs nobody -- which is the distinction the whole product
 * rests on and the easiest thing to flatten later into "you have 2 notifications".
 */

import { sampleSnapshot } from "@/lib/fixtures";
import type { Snapshot } from "@/lib/model";
import { decisionsFor, queueHeadline } from "@/lib/queue";
import { eventsOf } from "@/components/activity";

const APP = join(import.meta.dirname, "..", "src");

const sample = sampleSnapshot("test");

/** A snapshot with the two problem sources emptied, so a case can add back exactly one. */
const calm: Snapshot = { ...sample, drifted: [], publishers: sample.publishers.map((p) => ({ ...p, hasEquivocated: false })) };

describe("decisionsFor", () => {
  it("returns nothing when nothing needs anyone", () => {
    expect(decisionsFor(calm)).toHaveLength(0);
    expect(queueHeadline([])).toBe("Nothing needs your decision.");
  });

  it("ranks a provable lie above a change that might be benign", () => {
    /*
     * Equivocation first, and not because it is scarier. It is the only item with a reward attached -- whoever
     * submits the proof keeps a share of the bond -- and it is proven rather than suspected, so a reader with
     * one minute should spend it there.
     */
    const both: Snapshot = {
      ...sample,
      publishers: sample.publishers.map((p, i) => (i === 0 ? { ...p, hasEquivocated: true } : p)),
    };

    const decisions = decisionsFor(both);
    expect(decisions.length).toBeGreaterThan(1);
    expect(decisions[0]?.kind).toBe("equivocation");
  });

  it("says what widened rather than that something changed", () => {
    /*
     * The reason the detail line is worth its length. A reader deciding whether to open this needs to know
     * whether the new version can move money the approved one could not; "this skill has changed" makes them
     * click to find out, which spends the interruption the `widened` distinction exists to protect.
     */
    const decisions = decisionsFor(sample);
    const widened = decisions.find((d) => d.kind === "widened");

    expect(widened, "the fixture no longer contains a widening drift").toBeDefined();
    expect(widened?.detail).toMatch(/2 new capabilities, 2 of them high risk/);
    expect(widened?.detail, "the ceiling change is not named").toMatch(/ceiling rose from/);
    expect(widened?.href).toBe("/drift");
  });

  it("still lists a narrowing change, and says it narrowed", () => {
    /*
     * Hiding it would be worse than listing it. The hash still differs, so calls are still being refused --
     * a reader who saw nothing at all would be misled about why a skill stopped working. It sorts last and
     * carries a different word, which is the whole difference between ranking and filtering.
     */
    const narrowed: Snapshot = {
      ...calm,
      drifted: [
        {
          ...sample.drifted[0]!,
          diff: { ...sample.drifted[0]!.diff, added: [], widened: false, ceilingAfter: 0n },
        },
      ],
    };

    const decisions = decisionsFor(narrowed);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.kind).toBe("narrowed");
    expect(decisions[0]?.detail).toMatch(/still refused until it is re-approved/);
  });

  it("counts things needing a decision, not things that changed", () => {
    // "2 pending approvals" and "one of these can move money the version you approved could not" are the same
    // number and different products.
    expect(queueHeadline(decisionsFor(sample))).toMatch(/^\d+ thing(s)? needs? your decision\.$/);
  });

  it("gives every item a stable id", () => {
    // React keys. Ids derived from the snapshot's own hashes mean a refresh does not reshuffle the list.
    const ids = decisionsFor(sample).map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(decisionsFor(sample).map((d) => d.id)).toEqual(ids);
  });

  it("leaves refused calls out of the queue", () => {
    /*
     * A refusal is the system working and already resolved -- there is nothing to decide about one. In a queue
     * it would be an item that cannot be cleared, which is how a queue stops being believed. It belongs in the
     * activity feed as history, and that is where it is.
     */
    expect(sample.blocked.length, "the fixture has no refusals to test against").toBeGreaterThan(0);
    expect(decisionsFor(sample).some((d) => d.detail.includes("refused a"))).toBe(false);
  });
});

describe("the activity feed", () => {
  it("puts the newest event first, across both sources", () => {
    // Executions and refusals are two feeds merged into one record. A feed whose newest row is not at the top
    // is a feed a reader stops trusting after one glance, and it is a one-character mistake to make.
    const events = eventsOf(sample, 50);
    const times = events.map((e) => e.at);

    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]! <= times[i - 1]!, `event ${i} is newer than the one above it`).toBe(true);
    }
  });

  it("carries both kinds", () => {
    const kinds = new Set(eventsOf(sample, 50).map((e) => e.kind));
    expect(kinds.has("executed")).toBe(true);
    expect(kinds.has("refused")).toBe(true);
  });

  it("writes each row as actor, action, object", () => {
    /*
     * The shape is what makes a dense feed scannable: the eye learns where to look and stops re-parsing every
     * line. What it replaces is the templated entry -- "Updated", "Transaction sent", a bare hash -- which
     * records that something happened while withholding the thing the reader wanted, which was what.
     */
    const executed = eventsOf(sample, 50).find((e) => e.kind === "executed");
    expect(executed?.actor, "an execution has no actor").toBeDefined();
    expect(executed?.action).toMatch(/settled \d+ calls? against/);
    expect(executed?.object).not.toBe("");
  });

  it("names the guard rather than an address for a refusal", () => {
    // There is no executor to attribute a refusal to, and printing one would imply an address a reader could
    // go and look up.
    const refused = eventsOf(sample, 50).find((e) => e.kind === "refused");
    expect(refused?.actor).toBeUndefined();
  });

  it("passes the revert reason through unrewritten", () => {
    // An audit line that paraphrases the machine is a line a reader cannot match against a trace.
    const refused = eventsOf(sample, 50).find((e) => e.kind === "refused");
    expect(sample.blocked.map((b) => b.reason)).toContain(refused?.object);
  });

  it("respects the limit", () => {
    expect(eventsOf(sample, 2)).toHaveLength(2);
  });
});

describe("the dashboard leads with the decision, not the registry", () => {
  const page = readFileSync(join(APP, "app", "dashboard", "page.tsx"), "utf8");
  const verdict = readFileSync(join(APP, "components", "verdict.tsx"), "utf8");

  it("puts the verdict above everything else", () => {
    /*
     * The order this replaces put the quickstart first and the registry's "Live pins" count in the largest
     * type on the page, carrying the h1. So the most prominent thing on screen answered "how big is this
     * registry" when the question a returning reader arrives with is "is anything wrong with mine".
     */
    const order = ["<Verdict", "<Position", "<Quickstart", "<Registry", "<Activity"].map((marker) =>
      page.indexOf(marker),
    );

    for (const [index, at] of order.entries()) {
      expect(at, `marker ${index} is missing from the dashboard`).toBeGreaterThan(-1);
      if (index > 0) expect(at, `marker ${index} is out of order`).toBeGreaterThan(order[index - 1]!);
    }
  });

  it("makes the verdict sentence the route's h1", () => {
    // A dashboard whose heading is "Dashboard" has spent its most prominent line of type saying something the
    // navigation already said.
    expect(verdict).toMatch(/<h1[^>]*>\n?\s*\{queueHeadline\(decisions\)\}/);
    expect(page, "a second h1 is back on the page").not.toMatch(/level=\{1\}/);
  });

  it("offers one action, and only when there is one to take", () => {
    /*
     * The highest-drop moment in this category is the silence right after a wallet connects: the interface
     * loads, nothing says what to do, and the reader leaves. A button that always appeared would have to point
     * somewhere when nothing is wrong, and "go and look at something" is a link nobody follows.
     */
    expect(verdict).toMatch(/lead === undefined \? null : \(/);
    expect(verdict).toMatch(/href=\{lead\.href\}/);
  });

  it("never carries severity on colour alone", () => {
    // A hue plus a word, because a reader with a colour vision deficiency gets the same ranking as everyone
    // else, and because a filled amber row beside a filled red row is a banner stack rather than a queue.
    expect(verdict).toMatch(/KIND_LABEL\[decision\.kind\]/);
  });

  it("has no dead scoreboard left behind", () => {
    // Split into Verdict and Position. A dead component that still typechecks is what gets rediscovered and
    // reinstated next to the thing that replaced it.
    expect(() => readFileSync(join(APP, "components", "scoreboard.tsx"), "utf8")).toThrow();
  });
});
