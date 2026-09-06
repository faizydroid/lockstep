/**
 * The scoreboard's arithmetic.
 *
 * These figures sit in the largest type on the page and are the first thing a reader believes, so
 * the ratios get tested rather than trusted. The cases that matter are the degenerate ones: an empty
 * registry, where every denominator is zero, and the severity ordering, where two problems are
 * present at once and only one verdict can be shown.
 *
 * The denominator choice is also asserted, because it is a product decision that is easy to
 * "simplify" later into something wrong. Integrity divides by approvals, not by pins: a release
 * nobody approved cannot have drifted from anything, and dividing by pins would make a real problem
 * shrink as the registry filled up with unused releases.
 */

import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";

import { healthOf, verdictCopy } from "@/lib/health";
import { sampleSnapshot } from "@/lib/fixtures";
import type { Approval, DriftedSkill, Pin, Publisher, Snapshot } from "@/lib/model";

const ADDR = "0x1111111111111111111111111111111111111111" as Address;
const H = (n: string) => `0x${n.repeat(32)}` as Hex;

const pin = (overrides: Partial<Pin> = {}): Pin => ({
  pinId: H("11"),
  publisher: ADDR,
  skillHash: H("22"),
  versionId: H("33"),
  maxValuePerBatch: 0n,
  requiredBond: 125_000_000n,
  publishedAt: 1_772_000_000n,
  slashed: false,
  capabilities: [],
  state: "bonded",
  ...overrides,
});

const publisher = (overrides: Partial<Publisher> = {}): Publisher => ({
  address: ADDR,
  bondBalance: 0n,
  lockedBond: 0n,
  pinCount: 1,
  slashCount: 0,
  hasEquivocated: false,
  ...overrides,
});

const approval = (pinId: Hex): Approval => ({ account: ADDR, pinId, approvedAt: 1_772_000_100n });

const drift = (name: string): DriftedSkill => ({
  skillName: name,
  account: ADDR,
  approvedPinId: H("11"),
  approvedHash: H("22"),
  currentHash: H("44"),
  diff: {
    added: [],
    removed: [],
    unchanged: [],
    ceilingBefore: 0n,
    ceilingAfter: 0n,
    widened: false,
  },
});

/** An otherwise-empty snapshot, so each test states only the fields it cares about. */
const snap = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  ...sampleSnapshot('fixture'),
  pins: [],
  approvals: [],
  publishers: [],
  executions: [],
  blocked: [],
  drifted: [],
  ...overrides,
});

describe("healthOf", () => {
  it("reports full integrity when nothing has drifted", () => {
    const h = healthOf(snap({ approvals: [approval(H("11")), approval(H("12"))] }));
    expect(h.integrity).toBe(1);
    expect(h.approvedCount).toBe(2);
    expect(h.driftedCount).toBe(0);
    expect(h.verdict).toBe("settled");
  });

  it("divides drift by approvals, not by pins", () => {
    /*
     * Four pins exist but only two were approved, and one of those has drifted. Integrity must be
     * 1/2, not 3/4. If this ever reads 0.75 someone has swapped the denominator for the pin count,
     * which makes the number look better precisely as the registry grows.
     */
    const h = healthOf(
      snap({
        pins: [pin(), pin({ pinId: H("12") }), pin({ pinId: H("13") }), pin({ pinId: H("14") })],
        approvals: [approval(H("11")), approval(H("12"))],
        drifted: [drift("swap-router")],
      }),
    );
    expect(h.integrity).toBe(0.5);
  });

  it("clamps integrity at zero when drift exceeds approvals", () => {
    // Defensive: chain and disk reads land separately, so a transient state where the drift list is
    // longer than the approval list is reachable. It must not produce a negative ring.
    const h = healthOf({
      ...snap({ approvals: [approval(H("11"))] }),
      drifted: [drift("a"), drift("b"), drift("c")],
    });
    expect(h.integrity).toBe(0);
  });

  it("counts bond coverage over live pins only", () => {
    /*
     * Five pins: two bonded, one pinned without bond, one revoked, one slashed. Only the first three
     * are live, so coverage is 2/3. Counting the revoked and slashed pins would understate it, and
     * they are irrelevant -- a revoked pin vouches for nothing whether or not it has collateral.
     */
    const h = healthOf(
      snap({
        pins: [
          pin({ pinId: H("11"), requiredBond: 100n, state: "bonded" }),
          pin({ pinId: H("12"), requiredBond: 100n, state: "bonded" }),
          pin({ pinId: H("13"), requiredBond: 0n, state: "pinned" }),
          pin({ pinId: H("14"), requiredBond: 100n, state: "revoked" }),
          pin({ pinId: H("15"), requiredBond: 100n, state: "equivocated" }),
        ],
      }),
    );
    expect(h.liveCount).toBe(3);
    expect(h.bondedCount).toBe(2);
    expect(h.bondCoverage).toBeCloseTo(2 / 3);
  });

  it("treats an empty registry as whole rather than broken", () => {
    // 0/0 is the state of a fresh deployment. Reporting 0% integrity there would be alarming and
    // wrong: nothing is approved, so nothing has drifted.
    const h = healthOf(snap());
    expect(h.integrity).toBe(1);
    expect(h.bondCoverage).toBe(1);
    expect(h.verdict).toBe("watching");
  });

  it("counts a publisher as clean only with no slash and no equivocation", () => {
    const h = healthOf(
      snap({
        publishers: [
          publisher({ address: ADDR }),
          publisher({ address: H("aa") as unknown as Address, slashCount: 1 }),
          publisher({ address: H("bb") as unknown as Address, hasEquivocated: true }),
        ],
      }),
    );
    expect(h.publisherCount).toBe(3);
    expect(h.cleanPublishers).toBe(1);
    expect(h.equivocations).toBe(1);
  });

  it("ranks equivocation above drift in the verdict", () => {
    // Both problems present. The verdict is a single value and must show the worse one.
    const h = healthOf(
      snap({
        approvals: [approval(H("11"))],
        drifted: [drift("swap-router")],
        publishers: [publisher({ hasEquivocated: true })],
      }),
    );
    expect(h.verdict).toBe("blocked");
  });

  it("ranks drift above settled", () => {
    const h = healthOf(
      snap({ approvals: [approval(H("11"))], drifted: [drift("swap-router")] }),
    );
    expect(h.verdict).toBe("alarmed");
  });

  it("keeps the sample slashed total equal to the bonds on slashed pins", () => {
    /*
     * Internal coherence of the fixtures, asserted rather than assumed.
     *
     * The slashed total used to be the literal 1_625_000_000n. It was right, but only because someone
     * had done the sum by hand once, and a reviewer looking at the dashboard reasonably asked whether
     * the figures were invented. A literal cannot answer that; a derivation plus this test can.
     *
     * The registry locks a pin's bond at publish time and freezes it, so slashing takes exactly that
     * pin's requiredBond -- which makes this sum the correct one rather than merely a plausible one.
     */
    const snapshot = sampleSnapshot('fixture');
    const expected = snapshot.pins.reduce((sum, p) => (p.slashed ? sum + p.requiredBond : sum), 0n);
    expect(snapshot.totals.slashed).toBe(expected);
    // And it must be non-zero, or the assertion above passes vacuously on fixtures with no slash.
    expect(snapshot.totals.slashed).toBeGreaterThan(0n);
  });

  it("derives a coherent verdict from the sample snapshot", () => {
    // The fixtures ship a drifted skill on purpose, since a dashboard whose demo state is entirely
    // green never shows the reader what the product is for.
    const h = healthOf(sampleSnapshot('fixture'));
    expect(h.approvedCount).toBeGreaterThan(0);
    expect(["settled", "alarmed", "blocked"]).toContain(h.verdict);
  });
});

describe("verdictCopy", () => {
  it("uses the singular for one drifted skill", () => {
    const copy = verdictCopy(
      healthOf(snap({ approvals: [approval(H("11"))], drifted: [drift("a")] })),
    );
    expect(copy).toContain("1 approved skill no longer matches");
    expect(copy).not.toContain("skills");
  });

  it("uses the plural for several", () => {
    const copy = verdictCopy(
      healthOf(snap({ approvals: [approval(H("11")), approval(H("12"))], drifted: [drift("a"), drift("b")] })),
    );
    expect(copy).toContain("2 approved skills no longer match");
  });

  it("leads with equivocation when a publisher was slashed", () => {
    const copy = verdictCopy(
      healthOf(snap({ publishers: [publisher({ hasEquivocated: true })] })),
    );
    expect(copy).toContain("conflicting bytes");
  });

  it("explains an empty registry rather than congratulating it", () => {
    const copy = verdictCopy(healthOf(snap()));
    expect(copy).toContain("Nothing is approved yet");
  });

  it("states the count when everything matches", () => {
    const copy = verdictCopy(
      healthOf(snap({ approvals: [approval(H("11")), approval(H("12")), approval(H("13"))] })),
    );
    expect(copy).toContain("All 3 approved skills still match");
  });
});
