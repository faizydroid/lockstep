import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The two things the shell gained: a command palette, and a bottom tab bar on phones.
 *
 * Both are here because the app was missing something a reader arrives expecting. There was no search
 * anywhere in the product -- a registry explorer with no way to find a thing in the registry -- and every
 * destination on a phone was two taps away at the top of the screen, which is the hardest place to reach
 * one-handed.
 *
 * Source-level assertions, with the usual limit: they prove the wiring is there, not that a browser behaves.
 * What they catch is the specific defect each one names.
 */

const APP = join(import.meta.dirname, "..", "src");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const palette = readFileSync(join(APP, "components", "command-palette.tsx"), "utf8");
const paletteCode = stripComments(palette);
const nav = readFileSync(join(APP, "components", "nav.tsx"), "utf8");
const navCode = stripComments(nav);
const pins = readFileSync(join(APP, "app", "pins", "page.tsx"), "utf8");

describe("the command palette", () => {
  it("binds the keystroke a reader already knows, on both platforms", () => {
    /*
     * ⌘K on a Mac, Ctrl+K everywhere else, and the same control in both. Binding only one is how a Windows
     * reader concludes the product has no search.
     */
    expect(paletteCode).toMatch(/e\.metaKey \|\| e\.ctrlKey/);
    expect(paletteCode).toMatch(/e\.key\.toLowerCase\(\) === "k"/);
  });

  it("prints the modifier the reader's keyboard actually has", () => {
    /*
     * The binding accepts both; the printed hint has to pick one, and a static export has no `navigator` at
     * build time. Hardcoding "⌘K" would ship a Windows reader an instruction that does not work on their
     * keyboard -- which is worse than printing nothing, because they would conclude the search is broken
     * rather than that the label is.
     *
     * `undefined` until mounted, with a non-breaking space holding the width, so the wrong shortcut is never
     * on screen even for one frame and the swap is not a layout shift in the top bar.
     */
    expect(paletteCode).toMatch(/mac \? "⌘K" : "Ctrl K"/);
    expect(paletteCode).toMatch(/setMac\(\/mac\|iphone\|ipad\|ipod\/i\.test\(navigator\.userAgent\)\)/);
    expect(paletteCode, "the placeholder does not hold the width").toMatch(/min-w-9/);
  });

  it("takes the keystroke back from the browser", () => {
    // Ctrl+K is a legacy readline binding in some contexts, and Cmd+K inserts a link in others. Without
    // preventDefault the palette opens and something else also happens.
    const handler = /const onKey = \(e: KeyboardEvent\) => \{[\s\S]*?\n    \};/.exec(paletteCode)?.[0] ?? "";
    expect(handler, "the shortcut handler was not found").not.toBe("");
    expect(handler).toMatch(/e\.preventDefault\(\)/);
  });

  it("returns focus to the trigger when it closes", () => {
    /*
     * Without this, dismissing the palette drops focus on <body>, so the next Tab restarts from the top of
     * the document. For a keyboard reader the shortcut would cost them their place on the page every time.
     */
    const close = /const close = useCallback\([\s\S]*?\}, \[\]\);/.exec(paletteCode)?.[0] ?? "";
    expect(close, "the close handler was not found").not.toBe("");
    expect(close).toMatch(/triggerRef\.current\?\.focus\(\)/);
  });

  it("is a combobox over a listbox, with the active option announced", () => {
    /*
     * The pattern matters here in a way it did not for `Segmented`, which deliberately uses `aria-pressed`
     * because a tablist that owns no tabpanel announces "tab 1 of 3" and changes no region. This genuinely
     * is a text field filtering a list, so it gets the roles that say so -- and `aria-activedescendant` is
     * what makes arrow keys audible, since focus never leaves the input.
     */
    expect(paletteCode).toMatch(/role="combobox"/);
    expect(paletteCode).toMatch(/role="listbox"/);
    expect(paletteCode).toMatch(/role="option"/);
    expect(paletteCode).toMatch(/aria-activedescendant/);
    expect(paletteCode).toMatch(/aria-selected=\{index === active\}/);
  });

  it("keeps one flat list rather than a listbox per group", () => {
    // Three listboxes would break arrow-key traversal across the whole set, which is the one interaction a
    // palette has to get right. Headers are drawn on the first result of each kind instead.
    const listboxes = paletteCode.match(/role="listbox"/g) ?? [];
    expect(listboxes).toHaveLength(1);
    expect(paletteCode).toMatch(/results\[index - 1\]\?\.kind !== result\.kind/);
  });

  it("keeps the destinations that left the navigation findable", () => {
    /*
     * The reason this test exists. Account moved into the wallet menu and Settings is a tab inside it, so
     * without these two entries a keyboard reader has no path to either that does not require a mouse and a
     * dropdown. Moving a destination into a menu is only defensible if it stays reachable.
     */
    expect(paletteCode).toMatch(/href: "\/account"/);
    expect(paletteCode).toMatch(/href: "\/account#settings"/);
  });

  it("matches a pin on its hash and its publisher, not only its name", () => {
    /*
     * How a reader actually arrives with a pin: they paste a hash from a CI log, a badge or the CLI. A search
     * that matched only the name would refuse the input the product itself hands out.
     */
    const haystack = /function pinHaystack[\s\S]*?\n}/.exec(paletteCode)?.[0] ?? "";
    expect(haystack, "the pin haystack was not found").not.toBe("");
    expect(haystack).toMatch(/pin\.skillHash/);
    expect(haystack).toMatch(/pin\.publisher/);
    expect(haystack).toMatch(/pin\.versionId/);
  });

  it("cleans the publisher-controlled name before it reaches a result row", () => {
    // Skill names come from whoever published the pin. Every other surface runs them through `displayName`
    // and a search result is not an exception just because it is small.
    expect(paletteCode).toMatch(/displayName\(pin\.skillName\)/);
  });

  it("shows no pins until there is something to match on", () => {
    /*
     * An unfiltered registry would push the routes and actions off the first screen, so pressing ⌘K to reach
     * Drift would open on a list of pins. Empty query means destinations only.
     */
    expect(paletteCode).toMatch(/needle === ""\s*\n?\s*\? \[\]/);
    expect(paletteCode, "the pin results are unbounded").toMatch(/\.slice\(0, 8\)/);
  });

  it("sends a pin result at the page that already builds the verify command", () => {
    /*
     * `/pins?pin=<id>` rather than composing a `cast call` here. That page's Verify block builds the command
     * from the configured registry address, and two places composing the same command line is how one of
     * them ends up wrong.
     */
    expect(paletteCode).toMatch(/href: `\/pins\?pin=\$\{pin\.pinId\}`/);
    expect(paletteCode, "the palette composes its own cast command").not.toMatch(/cast call/);
  });
});

describe("a palette link to a pin actually changes the panel", () => {
  it("re-seeds the selection when the query string changes under it", () => {
    /*
     * The defect this closes, which the palette created.
     *
     * `/pins` seeds its selection from `window.location.search` in a mount effect, because `useSearchParams`
     * opts a static export into a Suspense boundary and ships the fallback as the prerendered page. That
     * mount effect does not re-run when the palette pushes `?pin=` from `/pins` itself -- so the URL changed,
     * the highlight did not, and the reader got a search result that silently did nothing.
     *
     * The sync effect has no dependency array on purpose: it runs after every render, reads one query
     * parameter and almost always no-ops. Clicking a row sets state before it rewrites the URL, so the two
     * already agree and this cannot fight it.
     */
    expect(pins).toMatch(/fromUrl !== undefined && fromUrl !== selectedId/);
  });
});

describe("the phone gets a tab bar rather than a hamburger", () => {
  it("puts primary navigation in the thumb zone", () => {
    expect(navCode).toMatch(/fixed inset-x-0 bottom-0/);
    expect(navCode, "the hamburger is back").not.toMatch(/aria-label="Open menu"/);
  });

  it("stays inside the three-to-five range, counting the overflow item", () => {
    /*
     * Past five, targets sit closer together than a fingertip is wide. Three destinations plus More is four,
     * and the grid has to agree with the list or the last cell is empty.
     */
    const hrefs = /const TAB_HREFS: readonly string\[\] = \[([^\]]*)\]/.exec(navCode)?.[1] ?? "";
    const count = (hrefs.match(/"/g) ?? []).length / 2;
    expect(count, `tab destinations: ${hrefs}`).toBe(3);
    expect(navCode).toMatch(/grid-cols-4/);
  });

  it("resolves the tabs against the shared link list", () => {
    // By href, not by duplicating the label and the outcome, so editing either happens in one place.
    expect(navCode).toMatch(/TAB_HREFS\.map\(\(href\) => LINKS\.find/);
  });

  it("labels every tab, because these words cannot be guessed from a glyph", () => {
    // An icon-only bar is a memory test at the best of times, and six of the seven labels here are coinages
    // of this project.
    expect(navCode).toMatch(/\{link\.label\}<\/span>/);
    expect(navCode).toMatch(/>More<\/span>/);
  });

  it("gives every target a fingertip to land on, clear of the home indicator", () => {
    /*
     * 44px is what a fingertip covers. The safe-area padding is not cosmetic either: without it the row sits
     * under the iOS home indicator, so the bottom third of every target is a system gesture area.
     */
    const targets = navCode.match(/min-h-\[44px\]/g) ?? [];
    expect(targets.length, "not every tab reserves a fingertip").toBeGreaterThanOrEqual(2);
    expect(navCode).toMatch(/pb-\[env\(safe-area-inset-bottom\)\]/);
  });

  it("opens the overflow sheet from the edge the finger is already on", () => {
    // The sheet used to drop from the top, back when the button that opened it was up there too. Sliding it
    // down from the top now would move the reader's hand away from where they just tapped.
    const sheet = /id="nav-sheet"[\s\S]*?transition=\{SPRING_SOFT\}/.exec(navCode)?.[0] ?? "";
    expect(sheet, "the overflow sheet was not found").not.toBe("");
    expect(sheet).toMatch(/initial=\{\{ y: "100%" \}\}/);
  });

  it("carries the same decision count as the rail", () => {
    // A badge that appears in one navigation and not the other teaches the reader that one of them lies.
    const tabs = /export function MobileTabs\(\)[\s\S]*?\n}/.exec(navCode)?.[0] ?? "";
    expect(tabs, "MobileTabs was not found").not.toBe("");
    expect(tabs).toMatch(/needsDecision/);
  });
});
