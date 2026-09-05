import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The wiring around the flow, as opposed to the rules inside it.
 *
 * `flow.test.ts` covers `stageFor` and `redirectFor` as functions. These are the mistakes that live at the
 * call sites instead, and every one of them produces a page that renders perfectly while trapping the
 * reader:
 *
 *   redirecting before storage is read, which bounces every returning reader to the landing page
 *   pushing instead of replacing, which makes the back button a no-op
 *   linking a mid-flow reader at a page the gate will bounce them off
 *   skipping a step in a way that does not actually skip it
 */

const APP = join(import.meta.dirname, "..", "src");

/**
 * Source with comments removed.
 *
 * Three assertions in this file failed on first run against prose rather than code: the no-forms check
 * matched a comment headed "Why this is not a `<form>`", and the `clear` check matched a comment warning
 * against `update({ profile: undefined })`. Naming a rejected pattern in order to reject it is precisely
 * what that commentary is for, so any assertion about what the code *does* has to read stripped source.
 * Assertions about copy still use the raw text, since copy is the thing being asserted.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const gate = readFileSync(join(APP, "components", "flow-gate.tsx"), "utf8");
const layout = readFileSync(join(APP, "app", "layout.tsx"), "utf8");
const landing = readFileSync(join(APP, "app", "page.tsx"), "utf8");
const start = readFileSync(join(APP, "components", "start.tsx"), "utf8");
const profile = readFileSync(join(APP, "app", "start", "profile", "page.tsx"), "utf8");
const onboarding = readFileSync(join(APP, "app", "start", "onboarding", "page.tsx"), "utf8");
const nav = readFileSync(join(APP, "components", "nav.tsx"), "utf8");

describe("the flow gate", () => {
  it("is mounted, or none of the rest of this matters", () => {
    expect(layout).toMatch(/<FlowGate \/>/);
    expect(layout).toMatch(/from "@\/components\/flow-gate"/);
  });

  it("waits for stored settings before redirecting anyone", () => {
    /*
     * The worst bug this component could have. Until localStorage is parsed a returning reader looks
     * exactly like a new one -- no profile, nothing acknowledged -- so acting in that window sends
     * everybody to the landing page on every cold load.
     */
    expect(gate).toMatch(/if \(!loaded\) return;/);
  });

  it("replaces rather than pushes", () => {
    // A pushed redirect leaves the bounced-from page in history, so back returns to it and the gate
    // immediately bounces again. Two taps and nothing moves.
    expect(gate).toMatch(/router\.replace\(target\)/);
    expect(gate).not.toMatch(/router\.push\(target\)/);
  });

  it("bails out when there is nothing to do, so it cannot loop", () => {
    expect(gate).toMatch(/if \(target === undefined\) return;/);
  });

  it("renders nothing", () => {
    // A wrapper would make every page pay a render for a decision about four of them, and would flash
    // the wrong content before deciding.
    expect(gate).toMatch(/return null;/);
  });
});

describe("nothing links a mid-flow reader somewhere they will be bounced from", () => {
  const chrome = readFileSync(join(APP, "components", "chrome.tsx"), "utf8");

  it("hides the navigation rail until the reader is out of the flow", () => {
    /*
     * The second time this trap appeared, and the worse of the two.
     *
     * The rail rendered on every route including the landing page, while the gate bounces a mid-flow
     * reader off product routes. A first-time visitor could therefore see Pins, Drift, Bonds and Badge in
     * the primary navigation, click one, and be silently returned to where they started. The hero's
     * buttons had already been fixed for exactly this; the rail had not, and a rail is the one thing a
     * reader trusts to be navigable.
     *
     * Two mounts rather than one now: the rail is `fixed` and lives outside the content column, the bar is
     * `sticky` and lives inside it. Both are gated on the same flag, which is what this protects.
     */
    expect(chrome).toMatch(/const inProduct = stage === "ready"/);
    expect(chrome).toMatch(/\{inProduct \? <Rail \/> : null\}/);
    expect(chrome).toMatch(/\{inProduct \? <NavBar \/> : <FlowBar \/>\}/);
  });

  it("offsets the content column by the rail, and only when there is a rail", () => {
    /*
     * The offset went away with the first rail and is back with the second. Both directions have bitten:
     * a stale offset pushes every page right against a sidebar that is not there, and a missing one puts
     * the whole dashboard underneath the sidebar that is.
     *
     * Asserted as one expression so the conditional cannot be dropped while the class survives. An
     * unconditional `lg:pl-[var(--rail)]` would indent the first-run flow pages against a rail those pages
     * deliberately do not render.
     */
    expect(stripComments(chrome), "the rail offset is missing").toMatch(
      /cx\(inProduct && "lg:pl-\[var\(--rail\)\]"\)/,
    );
  });

  it("keeps the only in-flow link pointed at a route allowed from every stage", () => {
    // The mark goes to "/", which is the landing page and therefore never a bounce, whatever the stage.
    const bar = /function FlowBar\(\)[\s\S]*?\n}/.exec(chrome)?.[0] ?? "";
    expect(bar).toMatch(/href="\/"/);
    for (const href of ["/dashboard", "/pins", "/drift", "/bonds", "/badge", "/account"]) {
      expect(bar, `the in-flow bar links to ${href}`).not.toContain(href);
    }
  });

  it("keeps the source banner and the CLI footer visible in both states", () => {
    /*
     * The banner is the disclosure that the figures are worked examples, and the landing page renders two
     * fingerprints and a refusal drawn from those fixtures. Tidying the caveat off the most-read page in
     * the app would be indefensible. The footer's note is a claim about the threat model, not navigation.
     */
    expect(chrome).toMatch(/<SourceBanner \/>/);
    expect(chrome).toMatch(/happens in the CLI, never here/);

    const guarded = /\{inProduct \? \([\s\S]*?<SourceBanner/.exec(chrome);
    expect(guarded, "the source banner is behind the inProduct branch").toBeNull();
  });

  it("keeps product links out of the landing page", () => {
    /*
     * The trap this replaced. The hero linked to /drift and /pins, and once a flow existed a first-time
     * reader would click one, be steered straight back, and reasonably conclude the site was broken.
     */
    for (const href of ["/drift", "/pins", "/bonds", "/approvals", "/publishers", "/badge"]) {
      expect(landing, `landing page links to ${href}`).not.toContain(`href="${href}"`);
    }
  });

  it("finishes the stage before following a tailored link out of onboarding", () => {
    // Same trap, one page later: the role-specific button leaves the flow, so it has to complete it.
    const tailored = /onClick=\{\(\) => \{[\s\S]*?router\.push\(pointer\.href\)/.exec(onboarding)?.[0] ?? "";
    expect(tailored).toMatch(/onboardingAcknowledged: true/);
  });

  it("makes the skip on the profile page actually skip", () => {
    /*
     * `stageFor` treats a missing profile as unfinished, so a skip that wrote nothing would land the
     * reader back on this page at the next navigation -- a skip button that does not skip. It writes the
     * "looking" role instead, which is a real answer rather than an absence.
     */
    const skip = /const skip = \(\) => \{[\s\S]*?\n  \};/.exec(profile)?.[0] ?? "";
    expect(skip).toMatch(/role: "looking"/);
    expect(skip).toMatch(/router\.push/);
  });
});

describe("the escape from the flow", () => {
  it("offers to look around without a wallet", () => {
    // Built as a wall this flow would lose the reader the product is for: a sceptic who will not produce
    // a wallet to examine an argument.
    expect(start).toMatch(/Look around first/);
    expect(start).toMatch(/skippedSetup: true/);
  });

  it("does not hide the escape behind having a wallet installed", () => {
    /*
     * Caught by check-export first. `available` is false until the client finds a provider, so gating the
     * skip on it kept the escape out of the static HTML entirely and left a reader with no extension
     * holding a single button.
     *
     * Asserted by position rather than by trying to match a JSX branch. The first attempt used
     * `/\{available \? \([\s\S]*?Look around first/`, which matched even though the code was correct: the
     * lazy match started at the primary button's genuine `available ?` branch and simply ran past its
     * closing `) : null}` to find the skip further down. Ordering says the same thing without the
     * regex needing to understand nesting.
     */
    const buttons = /const buttons = \([\s\S]*?\n  \);/.exec(stripComments(start))?.[0] ?? "";
    const closesBranch = buttons.indexOf(") : null}");
    const skipAt = buttons.indexOf("Look around first");

    expect(skipAt, "the skip button is missing").toBeGreaterThan(-1);
    expect(closesBranch, "the available-gated primary button is missing").toBeGreaterThan(-1);
    expect(skipAt, "the skip sits inside the available branch").toBeGreaterThan(closesBranch);
  });
});

describe("the profile page tells the truth about itself", () => {
  it("says there is no server and no account", () => {
    expect(profile).toMatch(/no server behind it/);
    expect(profile).toMatch(/local\s*\n?\s*storage|localStorage/);
  });

  it("explains the absence of an email field rather than just omitting it", () => {
    expect(profile).toMatch(/not asked for an email/);
  });

  it("collects no contact field", () => {
    // The type has none either, and settings.test.ts asserts serialise() never writes one.
    expect(profile).not.toMatch(/type="email"|type="tel"/);
  });

  it("removes a profile with clear rather than an undefined patch", () => {
    /*
     * The provider documents this trap: after a spread, `undefined` cannot be distinguished from "leave
     * it alone", so `update({ profile: undefined })` reports success and keeps the data.
     */
    expect(profile).toMatch(/clear\("profile"\)/);
    expect(stripComments(profile)).not.toMatch(/update\(\{ profile: undefined \}\)/);
  });

  it("uses a real radio input for the role", () => {
    // Arrow-key navigation, group semantics and the announced state all come free; a div with
    // role="radio" would have to reimplement every one of them.
    expect(profile).toMatch(/type="radio"/);
  });
});

describe("the app still has no forms", () => {
  it("adds none, because the CSP's form-action none is only meaningful while that holds", () => {
    /*
     * The layout sets `form-action 'none'` and explains that the directive has teeth precisely because this
     * app has no forms -- so any form in the DOM did not come from us and cannot post anywhere. That is a
     * real tripwire against an injected credential-phishing form, and the profile page deliberately wires
     * Enter by hand rather than spending it.
     */
    expect(layout).toMatch(/form-action 'none'/);

    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(path));
        else if (entry.name.endsWith(".tsx")) out.push(path);
      }
      return out;
    };

    for (const file of walk(APP)) {
      // Stripped, because the profile page's own comment is headed "Why this is not a `<form>`".
      const source = stripComments(readFileSync(file, "utf8"));
      expect(source, `${file.slice(APP.length + 1)} introduces a <form>`).not.toMatch(/<form[\s>]/);
    }
  });
});

describe("the nav points at the instrument", () => {
  it("lists the dashboard rather than the landing page", () => {
    expect(nav).toMatch(/href: "\/dashboard", label: "Dashboard"/);
    expect(nav).not.toMatch(/href: "\/", label: "Overview"/);
  });

  it("keeps the landing page reachable from the mark", () => {
    // A reader inside the product should not have the pitch in their primary rail, but they must be able
    // to get back to it.
    expect(nav).toMatch(/href="\/"/);
  });
});
