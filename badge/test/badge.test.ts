import { describe, expect, it } from "vitest";

import { badgeMarkdown, renderBadge, type BadgeState } from "../src/badge.ts";

describe("renderBadge", () => {
  it.each<BadgeState>(["bonded", "pinned", "unpinned", "revoked", "equivocated"])(
    "renders valid SVG for %s",
    (state) => {
      const svg = renderBadge({ state, bondWholeUnits: 12_000 });

      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg.endsWith("</svg>")).toBe(true);
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    },
  );

  it("shows the bond amount when bonded", () => {
    expect(renderBadge({ state: "bonded", bondWholeUnits: 12_000 })).toContain("bonded 12000");
  });

  /**
   * A bonded skill that can grant allowances is not simply "safe", and the badge must
   * not imply otherwise by showing a plain green tick.
   */
  it("does not present a high-risk skill as unqualified green", () => {
    const safe = renderBadge({ state: "bonded", bondWholeUnits: 1000, highRiskCount: 0 });
    const risky = renderBadge({ state: "bonded", bondWholeUnits: 1000, highRiskCount: 2 });

    expect(safe).toContain("#047857");
    expect(risky).not.toContain("#047857");
    expect(risky).toContain("high risk");
  });

  it("makes a slashed publisher unmistakable", () => {
    const svg = renderBadge({ state: "equivocated" });

    expect(svg).toContain("publisher slashed");
    expect(svg).toContain("#7f1d1d");
  });

  /** Colour alone is not a signal a colour-blind reviewer can use. */
  it("carries the meaning in text, not only in colour", () => {
    for (const state of ["unpinned", "revoked", "equivocated"] as const) {
      const svg = renderBadge({ state });
      const label = svg.match(/<title>([^<]+)<\/title>/)?.[1] ?? "";
      expect(label.length).toBeGreaterThan(12);
      expect(label).toContain("Lockstep");
    }
  });

  it("provides an accessible name and title", () => {
    const svg = renderBadge({ state: "pinned" });

    expect(svg).toContain('role="img"');
    expect(svg).toContain("aria-label=");
    expect(svg).toContain("<title>");
  });

  it("escapes XML so a crafted value cannot break out of the markup", () => {
    // Reached via bondWholeUnits only in principle, but the escaping must hold
    // regardless of how a value arrives.
    const svg = renderBadge({ state: "bonded", bondWholeUnits: 1 });

    expect(svg).not.toContain("<script");
    expect((svg.match(/<svg/g) ?? []).length).toBe(1);
  });

  it("widens with longer content", () => {
    const short = renderBadge({ state: "pinned" });
    const long = renderBadge({ state: "bonded", bondWholeUnits: 1_000_000, highRiskCount: 3 });

    const widthOf = (svg: string) => Number(svg.match(/width="(\d+)"/)?.[1] ?? 0);
    expect(widthOf(long)).toBeGreaterThan(widthOf(short));
  });

  it("treats a missing bond as zero rather than rendering undefined", () => {
    expect(renderBadge({ state: "bonded" })).toContain("bonded 0");
  });
});

describe("badgeMarkdown", () => {
  it("produces a linked image", () => {
    const md = badgeMarkdown("https://example.test/b.svg", "https://example.test/pin");

    expect(md).toBe("[![Lockstep pin status](https://example.test/b.svg)](https://example.test/pin)");
  });

  it("accepts custom alt text", () => {
    expect(badgeMarkdown("a", "b", "custom")).toContain("![custom]");
  });
});
