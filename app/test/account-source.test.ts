import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import type { Address } from "viem";

/**
 * Whose account the dashboard says it is reading.
 *
 * This exists because of a defect found while answering a question about the disconnect button. Disconnecting
 * clears the wallet *and* the `settings.account` override -- deliberately, since that override exists to scope
 * the dashboard to "me" and disconnecting is the statement that there is no "me" here any more. The resolution
 * then falls through to the address the build ships, so every account-scoped figure on the page silently
 * becomes somebody else's. The figures changed and nothing explained why.
 *
 * It is the mirror of a bug already fixed once: disconnect used to leave the *same* account showing, so the
 * button reported success while the dashboard carried on reading the reader's own approvals. Same class,
 * opposite direction, and both are the interface being wrong about whose data is on screen.
 */

import { resolveAccount } from "@/lib/account";

const APP = join(import.meta.dirname, "..", "src");

const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const SETTING = "0x2222222222222222222222222222222222222222" as Address;
const BUILD = "0x3333333333333333333333333333333333333333" as Address;

const banner = readFileSync(join(APP, "components", "source-banner.tsx"), "utf8");
const data = readFileSync(join(APP, "components", "data.tsx"), "utf8");
const identity = readFileSync(join(APP, "components", "identity.tsx"), "utf8");
const menu = readFileSync(join(APP, "components", "wallet-menu.tsx"), "utf8");

describe("resolveAccount", () => {
  it("prefers the wallet over everything, because the person is holding the key", () => {
    const all = resolveAccount({ configured: BUILD, setting: SETTING, wallet: WALLET });
    expect(all.address).toBe(WALLET);
    expect(all.origin).toBe("wallet");
  });

  it("prefers a deliberate setting over the build's default", () => {
    const set = resolveAccount({ configured: BUILD, setting: SETTING, wallet: undefined });
    expect(set.address).toBe(SETTING);
    expect(set.origin).toBe("setting");
  });

  it("falls back to the build, and says that is what it did", () => {
    /*
     * The case the whole file is about. Falling back is correct -- it is what makes a deployed demo show
     * something rather than an empty shell -- and it is only defensible if the origin travels with it.
     */
    const built = resolveAccount({ configured: BUILD, setting: undefined, wallet: undefined });
    expect(built.address).toBe(BUILD);
    expect(built.origin).toBe("build");
  });

  it("reports no account as a state rather than as a gap", () => {
    /*
     * A build with no configured address, nothing in settings and no wallet has no account-scoped data at all.
     * The pages about an account should say so rather than render as though the account were simply empty,
     * which is a different and much more alarming fact.
     */
    const none = resolveAccount({ configured: undefined, setting: undefined, wallet: undefined });
    expect(none.origin).toBe("none");
    expect(none.address).toBeUndefined();
  });

  it("models disconnect: clearing the wallet and the setting lands on the build", () => {
    // Exactly what `identity.disconnect` does, and therefore exactly what the banner has to disclose.
    const before = resolveAccount({ configured: BUILD, setting: WALLET, wallet: WALLET });
    const after = resolveAccount({ configured: BUILD, setting: undefined, wallet: undefined });

    expect(before.origin).toBe("wallet");
    expect(after.origin).toBe("build");
    expect(after.address, "disconnect left the reader's own address showing").not.toBe(before.address);
  });
});

describe("the resolution happens once", () => {
  it("has the reader and the disclosure call the same function", () => {
    /*
     * `data.tsx` needs the address to read with; the banner needs the origin to disclose. Computing the
     * precedence in both places is a pair that drifts, and a drifted disclosure is the worst failure available
     * here -- a banner confidently naming an account other than the one the figures came from.
     */
    expect(data).toMatch(/const account = resolveAccount\(\{/);
    expect(data).toMatch(/export function useAccountSource\(\)/);
    expect(banner).toMatch(/useAccountSource\(\)/);
  });

  it("leaves no second copy of the precedence in the effect", () => {
    // The three spreads this replaced. A leftover `...(address === undefined ? {} : { account: address })`
    // would work and would make `resolveAccount` decorative.
    expect(data, "the effect still overrides the account itself").not.toMatch(
      /\{ account: address \}|\{ account: settings\.account \}/,
    );
  });

  it("derives the disclosure rather than storing it", () => {
    /*
     * `resolveAccount` is pure over three inputs the provider already holds, so recomputing cannot disagree
     * with the read. Storing the effect's answer in state would leave the banner one render behind every
     * connect and disconnect -- naming the previous account at exactly the moment a reader is watching it
     * change, which is the one moment this disclosure exists for.
     */
    const hook = /export function useAccountSource\(\)[\s\S]*?\n}/.exec(data)?.[0] ?? "";
    expect(hook, "useAccountSource was not found").not.toBe("");
    expect(hook, "the hook reads state instead of resolving").not.toMatch(/useState|useContext/);
    expect(hook).toMatch(/resolveAccount\(\{/);
  });
});

describe("the banner says whose figures these are", () => {
  it("names the demo account when nothing else named one", () => {
    expect(banner).toMatch(/account\.origin === "build"/);
    expect(banner).toMatch(/demo account/);
    expect(banner, "the address is not shown, so a reader cannot tell which account").toMatch(
      /shortAddress\(account\.address \?\? ""\)/,
    );
  });

  it("explains the consequence, not just the condition", () => {
    /*
     * "demo account" tells a reader which mode the page is in. Saying that approvals, drift and executions
     * belong to somebody else's account is what stops one of those figures being read as their own.
     */
    expect(banner).toMatch(/belong to the account this deployment ships as its example/);
    expect(banner).toMatch(/Connect a wallet to see your own/);
  });

  it("says nothing extra when the wallet is the source", () => {
    /*
     * The expected case. The address is already in the chrome two inches away, and a pill restating it would
     * be the third place on screen saying the same thing.
     */
    expect(banner, "a note is pushed for the wallet case").not.toMatch(/origin === "wallet"/);
  });

  it("shows every override in effect rather than the first one", () => {
    /*
     * This was a chained ternary returning the first match, so a reader with a custom RPC *and* a custom
     * account was told about the RPC only. The whole condition attached to allowing those overrides is that
     * they get disclosed, and one winning over another was a quiet way to half-honour it.
     */
    expect(banner).toMatch(/notes\.push\(\{/);
    expect(banner).toMatch(/notes\.map\(\(note\)/);
    expect(banner, "the chained ternary is back").not.toMatch(/const override =/);
  });
});

describe("disconnect stays where it is", () => {
  it("navigates nowhere", () => {
    /*
     * The decision behind all of the above. Disconnect is not a logout -- EIP-1193 has no disconnect, so the
     * wallet's permission survives it -- and most of this dashboard does not depend on who is looking: pins,
     * publishers and bond totals are identical for everyone. Ejecting a reader from public data because they
     * put their key away would also dress the flow gate up as authentication, which a static export cannot
     * perform and which `lib/flow.ts` is explicit about not being.
     *
     * The reader who genuinely has no non-wallet reason to be there is already handled: `stageFor` returns
     * `landing` for someone who never finished a profile, so that redirect exists and is not this one.
     */
    const fn = /const disconnect = useCallback\([\s\S]*?\}, \[[^\]]*\]\);/.exec(identity)?.[0] ?? "";
    expect(fn, "the disconnect handler was not found").not.toBe("");
    expect(fn, "disconnect navigates").not.toMatch(/router|push\(|location\.(href|assign)/);

    expect(menu, "the menu navigates on disconnect").not.toMatch(/onDisconnect[\s\S]{0,80}router/);
  });
});
