import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { explorerTxUrl } from "../src/lib/chain";

/**
 * Locks the honesty of the write outcome.
 *
 * A write on this dashboard revokes an approval or challenges a publisher's bond. Those are irreversible,
 * and the whole surface used to end them in a 40px pill whose only detail -- the transaction hash -- sat in
 * a `title` attribute, invisible on touch and to a keyboard.
 *
 * Fixing that opened a worse risk than the one it closed. A completion state is an assertion, and the only
 * fact available at that point is that an RPC accepted a transaction. It may still revert. So these tests
 * are mostly about what the receipt must NOT claim, because that is the failure a screenshot would hide.
 */

const SRC = join(import.meta.dirname, "..", "src");
const write = readFileSync(join(SRC, "components", "write-action.tsx"), "utf8");

/**
 * The same file with comments removed.
 *
 * Needed for the "does not celebrate" assertion, which failed on first run against a comment that
 * explains why celebration is wrong here. Naming a rejected pattern in order to reject it is exactly what
 * that commentary is for, so the test was over-broad rather than the code.
 */
const code = write.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** The receipt function body, so assertions do not accidentally match the confirmation copy. */
const RECEIPT = /function Receipt\([\s\S]*?\n}/.exec(write)?.[0] ?? "";

describe("the receipt", () => {
  it("exists, so the selector below is testing something", () => {
    expect(RECEIPT.length).toBeGreaterThan(200);
  });

  it("shows the hash in a HashChip, not a title attribute", () => {
    // The defect this replaced. A hash nobody can copy is not a receipt.
    expect(RECEIPT).toMatch(/<HashChip value=\{hash\}/);
  });

  it("never claims the write succeeded", () => {
    // "Submitted, not yet settled" is the whole point. A tick or a "done" would assert an outcome the
    // chain has not returned, which is the exact claim-versus-reading confusion this product attacks.
    expect(write).toMatch(/Submitted, not yet settled/);
    expect(RECEIPT).toMatch(/submitted, not that it succeeded/);
    expect(RECEIPT).toMatch(/can\s*\n?\s*still revert/);
  });

  it("says the figures behind the dialog are still the old ones", () => {
    // Otherwise a reader closes the receipt, sees unchanged numbers, and concludes the write failed.
    expect(RECEIPT).toMatch(/next read of the chain/);
  });

  it("closes with Close rather than Done", () => {
    const buttons = /settled \? \([\s\S]*?\) : \(/.exec(write)?.[0] ?? "";
    expect(buttons).toMatch(/>\s*Close\s*</);
    expect(buttons).not.toMatch(/>\s*Done\s*</);
  });

  it("does not celebrate", () => {
    /*
     * The design material advises confetti on completion. It is wrong here twice over: these actions
     * revoke an approval or slash a bond, so celebration would be cheering a loss, and nothing is
     * confirmed yet anyway.
     */
    for (const word of ["confetti", "Congratulations", "Success!", "\u{1F389}"]) {
      expect(code.toLowerCase(), `write-action should not render "${word}"`).not.toContain(
        word.toLowerCase(),
      );
    }
  });

  it("keeps the guard from looking pleased about an unsettled transaction", () => {
    // `settled` is the happy mood in the Guard's vocabulary and it must not be used here.
    expect(write).toMatch(/mood=\{phase\.kind === "sent" \? "watching" : "alarmed"\}/);
  });

  it("marks the explorer as somewhere else, and opens it safely", () => {
    // An explorer is a third party. Naming the destination keeps the trust boundary visible.
    expect(RECEIPT).toMatch(/Watch it settle on the explorer/);
    expect(RECEIPT).toMatch(/rel="noreferrer noopener"/);
    expect(RECEIPT).toMatch(/target="_blank"/);
  });

  it("tolerates a chain with no explorer instead of guessing one", () => {
    expect(RECEIPT).toMatch(/url === undefined \? null/);
  });
});

describe("a failed write", () => {
  it("states that nothing changed, which is the reader's actual question", () => {
    expect(write).toMatch(/Nothing was sent/);
    expect(write).toMatch(/Your approvals are exactly as they/);
  });

  it("quotes the raw reason rather than paraphrasing it", () => {
    // Usually a revert or RPC string. Rewriting it loses the one detail that makes it searchable.
    expect(write).toMatch(/<code className="hash select-all text-revoked-ink">\{phase\.reason\}/);
  });
});

describe("explorerTxUrl", () => {
  const HASH = "0x0990fdb43e036ad9fdf2bdb8054ab836ef8a3ea391034b35880d262132762cec";

  /** Only the fields the explorer lookup reads. The rest of AppConfig is irrelevant to it. */
  const configFor = (chainId: 143 | 10143) =>
    ({ chainId, rpcUrl: "https://example.invalid", deployBlock: 0n, pinIds: [] }) as const;

  it("points at the testnet explorer for 10143", () => {
    const url = explorerTxUrl(HASH, configFor(10143));
    expect(url).toBe(`https://testnet.monadexplorer.com/tx/${HASH}`);
  });

  it("points somewhere different for mainnet, so a hash cannot be looked up on the wrong chain", () => {
    /*
     * The failure this prevents is quiet and confusing: an explorer for the wrong network returns "not
     * found" for a transaction that exists, which reads as the write having failed.
     */
    const url = explorerTxUrl(HASH, configFor(143));
    expect(url).not.toBeUndefined();
    expect(url).not.toContain("testnet");
    expect(url).toContain(`/tx/${HASH}`);
  });

  it("is derived from viem's chain definition rather than a literal in our source", () => {
    const chain = readFileSync(join(SRC, "lib", "chain.ts"), "utf8");
    const fn = /export function explorerTxUrl[\s\S]*?\n}/.exec(chain)?.[0] ?? "";
    expect(fn).toMatch(/blockExplorers\?\.default\.url/);
    // A hardcoded explorer host would be a second source of truth that can only be more wrong.
    expect(fn).not.toMatch(/https:\/\/[a-z.]*monad/);
  });
});
