import { describe, expect, it } from "vitest";
import type { Address } from "viem";

import { sampleSnapshot } from "../src/lib/fixtures";
import { VISIT_STEPS, nextStep, quickstart } from "../src/lib/quickstart";
import type { Snapshot } from "../src/lib/model";
import { GUARD_STORAGE_SLOT } from "../src/lib/profile";

/**
 * The quickstart derives steps from observable state rather than from a stored checklist, and these
 * tests are mostly about the consequences of that choice.
 *
 * The usual advice is to never start a user at zero, on the car-wash finding that a card with two
 * stamps pre-filled beat an equivalent empty one. Two of those stamps were free, and a product arguing
 * that a claim is not a reading does not get to open with a motivational fiction. So the first step is
 * satisfied because it is genuinely true on arrival, and the property that follows -- progress can go
 * *down* when something stops being true -- is the one a stored checklist could never have.
 */

const ACCOUNT = "0x209C903f68f169C8e654e0C3C91cAdc4C4A4aFF2" as Address;

/** A snapshot that is reading chain, with nothing account-specific satisfied. */
function liveSnapshot(patch: Partial<Snapshot> = {}): Snapshot {
  const base = sampleSnapshot("test");
  return {
    ...base,
    source: {
      kind: "chain",
      chainId: 10143,
      registry: "0xe784a386591cFcE683fAd2C678C8A3c282a9e17b" as Address,
      blockNumber: 59640065n,
    },
    approvals: [],
    ...patch,
  };
}

const guardedAccount = {
  address: ACCOUNT,
  delegation: { kind: "delegated", implementation: ACCOUNT } as const,
  guard: { kind: "confirmed", slot: GUARD_STORAGE_SLOT } as const,
  pointedAtConfiguredGuard: true,
};

describe("quickstart", () => {
  it("never starts at zero, and the reason is that the first step is true", () => {
    const state = quickstart(liveSnapshot(), []);

    expect(state.done).toBeGreaterThan(0);
    const first = state.steps[0];
    expect(first?.id).toBe("read-registry");
    expect(first?.done).toBe(true);
  });

  it("does start at zero when the dashboard is honestly not reading anything", () => {
    // The line that keeps this from being a trick. On a sample build the first step is false, because
    // it would be false, and the panel says so instead of granting a stamp.
    const state = quickstart(sampleSnapshot("no registry configured"), []);

    expect(state.done).toBe(0);
    expect(state.steps[0]?.done).toBe(false);
    expect(state.steps[0]?.why).toMatch(/worked examples/);
  });

  it("lets no chain-derived step be satisfied by fixtures", () => {
    // A real bug this suite caught. The sample snapshot ships fixture approvals, which made "approve a
    // version" read as done on an unconfigured dashboard -- reporting progress against work nobody had
    // done, which is exactly the fiction this module exists to avoid, arrived at by accident.
    const sample = sampleSnapshot("nothing configured");
    expect(sample.approvals.length).toBeGreaterThan(0);

    const state = quickstart(sample, []);
    for (const step of state.steps) {
      expect(step.done, `${step.id} must not be satisfied by fixtures`).toBe(false);
    }
  });

  it("still credits a visit on a sample build, because the visit really happened", () => {
    // The distinction the whole app runs on. Opening /drift is something the reader did, whatever the
    // data on it came from. An approval is a claim about chain state, and there is none here.
    const state = quickstart(sampleSnapshot("sample"), [VISIT_STEPS["/drift"]]);

    expect(state.steps.find((s) => s.id === "saw-drift")?.done).toBe(true);
    expect(state.steps.find((s) => s.id === "approve-version")?.done).toBe(false);
  });

  it("hides the count until something is satisfied", () => {
    // "0 of 5" before any value has landed reads as a demand rather than as progress.
    expect(quickstart(sampleSnapshot("sample"), []).showCount).toBe(false);
    expect(quickstart(liveSnapshot(), []).showCount).toBe(true);
  });

  it("satisfies the refusal step from a remembered visit", () => {
    const before = quickstart(liveSnapshot(), []);
    const after = quickstart(liveSnapshot(), [VISIT_STEPS["/drift"]]);

    expect(before.steps.find((s) => s.id === "saw-drift")?.done).toBe(false);
    expect(after.steps.find((s) => s.id === "saw-drift")?.done).toBe(true);
    expect(after.done).toBe(before.done + 1);
  });

  it("satisfies enforcement only when the guard is confirmed", () => {
    const confirmed = quickstart(liveSnapshot({ account: guardedAccount }), []);
    expect(confirmed.steps.find((s) => s.id === "check-enforcement")?.done).toBe(true);

    // Delegated, but to something that is not this guard. Storage would look identical.
    const elsewhere = quickstart(
      liveSnapshot({
        account: {
          ...guardedAccount,
          guard: { kind: "other", slot: `0x${"11".repeat(32)}` },
          pointedAtConfiguredGuard: false,
        },
      }),
      [],
    );
    expect(elsewhere.steps.find((s) => s.id === "check-enforcement")?.done).toBe(false);
  });

  it("lets progress go down, which is the point of deriving it", () => {
    // A stored checklist would keep telling someone their account was set up after they switched to
    // one that is not. This cannot, because the step is a condition rather than a record.
    const withAccount = quickstart(liveSnapshot({ account: guardedAccount }), []);
    const withoutAccount = quickstart(liveSnapshot(), []);

    expect(withoutAccount.done).toBeLessThan(withAccount.done);
  });

  it("satisfies the publish step only for an account that has published here", () => {
    const publishers = [
      { address: ACCOUNT, bondBalance: 0n, lockedBond: 1n, pinCount: 1, slashCount: 0, hasEquivocated: false },
    ];

    expect(
      quickstart(liveSnapshot({ account: guardedAccount, publishers }), []).steps.find(
        (s) => s.id === "publish-pin",
      )?.done,
    ).toBe(true);

    // Same publisher list, no account being viewed: nothing to match against.
    expect(
      quickstart(liveSnapshot({ publishers }), []).steps.find((s) => s.id === "publish-pin")?.done,
    ).toBe(false);
  });

  it("matches the publisher case-insensitively", () => {
    const publishers = [
      {
        address: ACCOUNT.toLowerCase() as Address,
        bondBalance: 0n,
        lockedBond: 1n,
        pinCount: 1,
        slashCount: 0,
        hasEquivocated: false,
      },
    ];
    expect(
      quickstart(liveSnapshot({ account: guardedAccount, publishers }), []).steps.find(
        (s) => s.id === "publish-pin",
      )?.done,
    ).toBe(true);
  });

  it("marks the two CLI-only steps and gives them no link", () => {
    // Showing them as clickable would promise something the app will never do. Hiding them would
    // describe a shorter product than the real one.
    const state = quickstart(liveSnapshot(), []);
    const cliOnly = state.steps.filter((s) => s.cliOnly === true);

    expect(cliOnly.map((s) => s.id)).toEqual(["approve-version", "publish-pin"]);
    for (const step of cliOnly) {
      expect(step.href, step.id).toBeUndefined();
    }
  });

  it("explains why approving has no button rather than just omitting one", () => {
    const step = quickstart(liveSnapshot(), []).steps.find((s) => s.id === "approve-version");
    expect(step?.why).toMatch(/bytes on your disk/);
  });

  it("reports complete only when every step is satisfied", () => {
    const publishers = [
      { address: ACCOUNT, bondBalance: 0n, lockedBond: 1n, pinCount: 1, slashCount: 0, hasEquivocated: false },
    ];
    const everything = quickstart(
      liveSnapshot({
        account: guardedAccount,
        publishers,
        approvals: sampleSnapshot("x").approvals,
      }),
      [VISIT_STEPS["/drift"]],
    );

    expect(everything.complete).toBe(true);
    expect(everything.done).toBe(everything.total);
  });

  it("is not complete when only some steps are satisfied", () => {
    expect(quickstart(liveSnapshot(), [VISIT_STEPS["/drift"]]).complete).toBe(false);
  });

  it("ignores visit ids it does not know about", () => {
    const state = quickstart(liveSnapshot(), ["not-a-step", "saw-nothing"]);
    expect(state.done).toBe(quickstart(liveSnapshot(), []).done);
  });
});

describe("nextStep", () => {
  it("points at the first unsatisfied step that can be acted on in the browser", () => {
    const state = quickstart(liveSnapshot(), []);
    expect(nextStep(state)?.id).toBe(VISIT_STEPS["/drift"]);
  });

  it("skips ahead once an earlier step is satisfied", () => {
    const state = quickstart(liveSnapshot(), [VISIT_STEPS["/drift"]]);
    expect(nextStep(state)?.id).toBe("check-enforcement");
  });

  it("returns nothing when only CLI-only steps remain", () => {
    // "Next" has to be something the reader can do from where they are standing. Linking to a page
    // that cannot help would be worse than saying there is nothing to click.
    const state = quickstart(liveSnapshot({ account: guardedAccount }), [VISIT_STEPS["/drift"]]);

    expect(state.complete).toBe(false);
    expect(nextStep(state)).toBeUndefined();
  });
});
