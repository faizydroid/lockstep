import { describe, expect, it } from "vitest";

import {
  badgeFileName,
  badgeMarkdown,
  badgeSnippet,
  pinUrl,
  renderBadge,
  LOCKSTEP_DASHBOARD,
  type BadgeState,
} from "../src/badge.ts";

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

describe("badgeFileName", () => {
  it("slugs a normal skill name", () => {
    expect(badgeFileName("kuru-quote")).toBe("lockstep-kuru-quote.svg");
    expect(badgeFileName("Kuru Quote")).toBe("lockstep-kuru-quote.svg");
  });

  it("collapses anything that is not path-safe, since this becomes a path and a markdown URL", () => {
    expect(badgeFileName("a/b")).toBe("lockstep-a-b.svg");
    expect(badgeFileName("skill name!@#$")).toBe("lockstep-skill-name.svg");
    expect(badgeFileName("a)](javascript:alert(1))")).toBe("lockstep-a-javascript-alert-1.svg");
  });

  it("drops dots entirely rather than emitting a name nobody can explain", () => {
    // Legal in a filename, and `lockstep-..-..-etc-passwd.svg` for `../../etc/passwd` is not a name
    // anyone should have to reason about. There were no separators left to traverse with either way.
    expect(badgeFileName("../../etc/passwd")).toBe("lockstep-etc-passwd.svg");
    expect(badgeFileName("v1.2.3")).toBe("lockstep-v1-2-3.svg");
  });

  it("collapses runs of dashes", () => {
    expect(badgeFileName("a///b")).toBe("lockstep-a-b.svg");
  });

  it("never produces a traversal or an absolute path", () => {
    for (const name of ["../../..", "/etc/passwd", "C:\\windows", "..", "."]) {
      const file = badgeFileName(name);
      expect(file.includes("/"), name).toBe(false);
      expect(file.includes("\\"), name).toBe(false);
      expect(file.startsWith("lockstep-"), name).toBe(true);
    }
  });

  it("falls back rather than emitting a bare prefix", () => {
    expect(badgeFileName("")).toBe("lockstep-pin.svg");
    expect(badgeFileName("!!!")).toBe("lockstep-pin.svg");
    expect(badgeFileName("---")).toBe("lockstep-pin.svg");
  });
});

describe("pinUrl", () => {
  const pin = `0x${"ab".repeat(32)}`;

  it("builds a dashboard link", () => {
    expect(pinUrl("https://lockstep.dev", pin)).toBe(`https://lockstep.dev/pins?pin=${pin}`);
  });

  it("does not double the slash when the base has a trailing one", () => {
    expect(pinUrl("https://lockstep.dev/", pin)).toBe(`https://lockstep.dev/pins?pin=${pin}`);
    expect(pinUrl("https://lockstep.dev///", pin)).toBe(`https://lockstep.dev/pins?pin=${pin}`);
  });
});

/**
 * The one place the real host is asserted.
 *
 * Every other test above passes an arbitrary base on purpose — a unit test of URL joining should not
 * care where the site lives. But the value production uses is now a single exported constant that the
 * CLI, the Action and the dashboard's own preview all read, and it ends up pasted into other people's
 * READMEs where a mistake is published somewhere nobody can edit. So its shape is checked once, here.
 *
 * The trailing-slash assertion is not pedantry: `pinUrl` strips them, but the constant is also
 * concatenated directly in the CLI's post-publish output, which does not.
 */
describe("LOCKSTEP_DASHBOARD", () => {
  const pin = `0x${"ab".repeat(32)}`;

  it("is the deployed host, over https, with no trailing slash", () => {
    expect(LOCKSTEP_DASHBOARD).toBe("https://lockstep.dofolabs.space");
    expect(LOCKSTEP_DASHBOARD.endsWith("/")).toBe(false);
  });

  it("produces the pin link a badge points at", () => {
    expect(pinUrl(LOCKSTEP_DASHBOARD, pin)).toBe(
      `https://lockstep.dofolabs.space/pins?pin=${pin}`,
    );
  });
});

describe("badgeSnippet", () => {
  const pin = `0x${"cd".repeat(32)}`;

  it("uses a relative image and an absolute link, which is the whole design", () => {
    // Relative image or it phones home; absolute link because a README is read on github.com and the
    // registry is not there.
    const snippet = badgeSnippet({ skillName: "kuru-quote", pinId: pin, dashboard: "https://lockstep.dev" });

    expect(snippet.fileName).toBe("lockstep-kuru-quote.svg");
    expect(snippet.markdown).toContain("(lockstep-kuru-quote.svg)");
    expect(snippet.markdown).not.toContain("https://lockstep.dev/lockstep-");
    expect(snippet.markdown).toContain(`https://lockstep.dev/pins?pin=${pin}`);
  });

  it("produces markdown in the shape a README expects", () => {
    const snippet = badgeSnippet({ skillName: "kuru-quote", pinId: pin, dashboard: "https://lockstep.dev" });
    expect(snippet.markdown).toBe(
      `[![Lockstep pin for kuru-quote](lockstep-kuru-quote.svg)](${snippet.linkUrl})`,
    );
  });

  it("does not let a skill name inject a link into the publisher's README", () => {
    /*
     * A real hole this test found, not a hypothetical. The alt text interpolated the raw skill name,
     * so `evil](https://phish.example)(` terminated the markdown link early and smuggled a second,
     * attacker-chosen link into whatever README the snippet was pasted into -- pasted by the
     * publisher, from output they had every reason to trust.
     */
    const snippet = badgeSnippet({
      skillName: "evil](https://phish.example)(",
      pinId: pin,
      dashboard: "https://lockstep.dev",
    });

    expect(snippet.fileName).not.toContain(")");
    expect(snippet.fileName).not.toContain("]");

    /*
     * The property that matters is structural, not textual.
     *
     * `phish.example` survives as inert alt text, because `.` is legitimately wanted in a name like
     * `kuru-quote v1.2`. Text is not a link. What must not survive is the bracket-paren sequence that
     * would end the markdown early, so this asserts exactly two `](` -- one closing the image, one
     * closing the link -- and that the only URL is ours.
     */
    expect(snippet.markdown.match(/\]\(/g)).toHaveLength(2);
    expect(snippet.markdown.match(/https?:\/\//g)).toHaveLength(1);
    expect(snippet.markdown).toContain(`](${snippet.linkUrl})`);
  });

  it("keeps a readable alt text for an ordinary name", () => {
    const snippet = badgeSnippet({ skillName: "kuru-quote", pinId: pin, dashboard: "https://lockstep.dev" });
    expect(snippet.markdown).toContain("Lockstep pin for kuru-quote");
  });

  it("falls back to a usable alt text when nothing survives", () => {
    const snippet = badgeSnippet({ skillName: "]]](((", pinId: pin, dashboard: "https://lockstep.dev" });
    expect(snippet.markdown).toContain("Lockstep pin for pin");
  });
});
