import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The account control, and the bug that made replacing it urgent rather than cosmetic.
 *
 * Disconnect used to clear the wallet address and nothing else. `data.tsx` resolves whose account to read in
 * order of specificity -- the build's configured address, then a `settings.account` override, then the
 * connected wallet -- and the quickstart's "point this at your account" step writes the override with the
 * connected address, on purpose, so its checklist can be satisfied.
 *
 * So a reader who had been through the quickstart and then disconnected watched the address vanish from the
 * chrome while every figure stayed exactly where it was, still reading their account. The interface reported
 * that the link was cut and it was not. On a security tool that is the worst class of bug available, which is
 * why it gets the first assertions here.
 *
 * Source-level checks, with the usual limit: they prove the wiring exists, not that a browser behaves. What
 * they catch is the specific regression, and every one of these was a real defect rather than a hypothetical.
 */

const APP = join(import.meta.dirname, "..", "src");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const identity = readFileSync(join(APP, "components", "identity.tsx"), "utf8");
const menu = readFileSync(join(APP, "components", "wallet-menu.tsx"), "utf8");
const nav = readFileSync(join(APP, "components", "nav.tsx"), "utf8");
const control = readFileSync(join(APP, "components", "account-control.tsx"), "utf8");

describe("disconnect actually disconnects", () => {
  it("clears the account override, not just the wallet address", () => {
    const fn = /const disconnect = useCallback\([\s\S]*?\}, \[[^\]]*\]\);/.exec(identity)?.[0] ?? "";
    expect(fn, "the disconnect handler was not found").not.toBe("");
    expect(fn).toMatch(/setAddress\(undefined\)/);
    expect(fn, "the settings override survives a disconnect").toMatch(/clearSetting\("account"\)/);
  });

  it("says what it does and what it cannot do", () => {
    /*
     * The button read "Forget address", which was accurate about our storage and silent about both things a
     * reader wants: that the dashboard stops being scoped to them, and that the wallet keeps its own
     * permission regardless. EIP-1193 has no disconnect, so the second half can never be promised.
     */
    expect(menu).toMatch(/Disconnect/);
    expect(menu).toMatch(/Stops this dashboard reading your account/);
    expect(menu).toMatch(/wallet keeps its own permission/);
    expect(stripComments(menu), "the old label is back").not.toMatch(/Forget address/);
  });
});

describe("the wallet menu follows the convention it borrows", () => {
  it("collapses to an identicon, a truncated address and a chevron", () => {
    expect(menu).toMatch(/fingerprintSeed\(address\)/);
    expect(menu).toMatch(/shortAddress\(address\)/);
    expect(menu).toMatch(/function Chevron/);
    expect(menu).toMatch(/aria-haspopup="menu"/);
  });

  it("is dismissible by keyboard and by clicking away", () => {
    expect(menu).toMatch(/event\.key === "Escape"/);
    expect(menu).toMatch(/pointerdown/);
  });

  it("reserves its width while the session restores", () => {
    /*
     * The silent `eth_accounts` check takes a moment. Rendering nothing and then a button shifts the whole
     * navbar sideways after paint, on the element a reader is most likely to be reaching for.
     */
    expect(menu).toMatch(/h-9 w-28 animate-pulse/);
  });

  it("gives the wrong network the whole button rather than a line in the menu", () => {
    /*
     * On the wrong chain every read is against a registry that does not exist there, so nothing on the page
     * means anything until it is fixed. Behind a chevron, a reader sees an empty registry and concludes the
     * product is empty.
     */
    expect(menu).toMatch(/if \(!onCorrectChain\)/);
    expect(menu).toMatch(/Wrong network/);
  });

  it("answers the enforcement question with three states, not two", () => {
    /*
     * "Not read yet" is not "nothing is enforcing it". Collapsing them would report a false negative for the
     * duration of every chain read, about the one fact this product exists to surface.
     */
    expect(menu).toMatch(/not read yet/);
    expect(menu).toMatch(/LockstepGuard/);
    expect(menu).toMatch(/pointedAtConfiguredGuard/);
  });

  it("carries the profile and a way through to the pages that need room", () => {
    // The profile is what "top right" means in this category; the delegation checks and settings are pages.
    expect(menu).toMatch(/ROLE_LABEL/);
    expect(menu).toMatch(/href="\/account"/);
  });

  it("renders no profile rather than inventing one", () => {
    // A reader who skipped the profile step gets the address alone. "Anonymous" would be filling a field
    // nobody agreed to.
    expect(menu).toMatch(/profile === undefined \?/);
  });
});

describe("the navigation is a rail beside a slim bar", () => {
  it("draws the rail from the shared width token, in both states", () => {
    /*
     * The rail sets its own width and the content column offsets by the same amount, from two different
     * components. The token is the only place they can agree, so a literal `w-56` here would be a pair
     * that silently drifts the first time either number is adjusted.
     */
    expect(stripComments(nav), "the rail width is not read from the token").toMatch(/w-\[var\(--rail\)\]/);
    expect(nav, "the bar is no longer 56px").toMatch(/h-14/);
  });

  it("puts the account control in the bar, not the rail", () => {
    /*
     * Top right is what this category means by "the account", and the rail is for destinations. A wallet
     * control in a collapsible panel would disappear at exactly the width where a reader most wants it.
     */
    const bar = /export function NavBar\(\)[\s\S]*?\n}/.exec(nav)?.[0] ?? "";
    expect(bar, "the wallet menu left the bar").toMatch(/<WalletMenu \/>/);

    const rail = /export function Rail\(\)[\s\S]*?\n}/.exec(nav)?.[0] ?? "";
    expect(rail, "the wallet menu is in the rail as well").not.toMatch(/WalletMenu/);
  });

  it("keeps the account reachable from the navigation, not only from the menu", () => {
    /*
     * This assertion used to say the opposite, and the reversal is worth recording.
     *
     * Account was taken out of the rail when its facts moved into the wallet menu, on the argument that a nav
     * item pointing at the same information is two front doors to one room. That was half right. The menu is
     * the right home for the *facts* of the connected wallet -- address, network, whether anything is
     * enforcing -- which is what a chevron next to an address promises. It is the wrong home for a route,
     * because a page reachable only through a dropdown is a page a keyboard reader has to already know exists.
     *
     * So both point at `/account`, and the rail's foot also carries `#settings`, which nothing else did.
     */
    expect(stripComments(nav), "the account left the navigation again").toMatch(/href: "\/account"/);
    expect(stripComments(nav), "settings is unreachable from the navigation").toMatch(
      /href: "\/account#settings"/,
    );
    expect(menu, "the menu stopped linking through to the page").toMatch(/href="\/account"/);
  });

  it("puts the account, settings and theme at the foot of the rail", () => {
    /*
     * Position carries the meaning here. Separated from the primary nav by a rule and pinned below it, they
     * read as being about the reader rather than about the registry -- which is where this category puts them
     * and therefore where a reader looks without being told.
     *
     * The theme control moved out of the top bar for a related reason: that bar carries the two things which
     * decide whether the figures on screen mean anything, the network and the wallet, and three icons of
     * appearance beside those were competing with them for nothing.
     */
    const rail = /export function Rail\(\)[\s\S]*?\n}/.exec(nav)?.[0] ?? "";
    expect(rail, "Rail was not found").not.toBe("");
    expect(rail).toMatch(/SECONDARY\.map/);
    expect(rail).toMatch(/<ThemeToggle stack=\{!expanded\} \/>/);

    const bar = /export function NavBar\(\)[\s\S]*?\n}/.exec(nav)?.[0] ?? "";
    expect(bar, "the theme control is still in the bar at every width").toMatch(/hidden sm:block lg:hidden/);
  });

  it("marks only one of the two account rows as current", () => {
    /*
     * `/account#settings` is a tab inside `/account`, and `usePathname` cannot see a hash. A `startsWith` test
     * would light both rows at once and tell the reader they are in two places.
     */
    expect(nav).toMatch(/active=\{link\.highlight && isActive\("\/account"\)\}/);
  });

  it("keeps the icons, which the rail was the right layout for all along", () => {
    /*
     * 19px glyphs beside a label and its outcome line. They were dropped from the horizontal bar because
     * inline at 13px they duplicated the word next to them; in a vertical item they are the thing that
     * survives when the rail collapses, and they carry an `sr-only` label so the collapsed state is not a
     * picture-only menu.
     */
    expect(nav).toMatch(/<Icon heavy=\{active\} \/>/);
    expect(nav).toMatch(/nav-sheet/);
  });

  it("has no dead account panel left behind", () => {
    /*
     * `AccountControl` was 130 lines and had no consumer once the rail went. Deleted rather than left
     * unused, because a dead component that still typechecks is what gets rediscovered and reinstated.
     */
    expect(control, "AccountControl is back").not.toMatch(/export function AccountControl/);
    expect(control, "fingerprintSeed was lost with it").toMatch(/export function fingerprintSeed/);
  });
});
