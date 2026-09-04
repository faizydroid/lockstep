"use client";

/**
 * The connect / account control at the foot of the rail.
 *
 * Five states, and the two most connect buttons skip are the ones that cause support tickets:
 *
 *   No wallet in the browser. Says so, instead of rendering a button that cannot work. A dead
 *   "Connect" makes a reader think the product is broken rather than their browser incomplete.
 *
 *   Restoring. A skeleton, so nobody clicks into a race with the silent `eth_accounts` check.
 *
 *   Disconnected. One heavy button, plus what connecting will and will not buy.
 *
 *   Connected on the wrong chain. The state everyone forgets. The wallet is attached, the address is
 *   real, and every read and write will be against a chain with no registry on it. Prompting to switch
 *   is the only useful thing to render here, and doing it well is the difference between "the dashboard
 *   is empty" and "you are on the wrong network".
 *
 *   Connected and correct. Address, its fingerprint, and a way to forget it.
 */

import { shortAddress } from "@/lib/format";

import { HashFingerprint } from "./fingerprint";
import { CHAIN_ID, useIdentity } from "./identity";
import { Button, cx } from "./ui";

export function AccountControl() {
  const {
    available,
    ready,
    connected,
    address,
    chainId,
    onCorrectChain,
    connect,
    disconnect,
    switchChain,
    connecting,
    error,
  } = useIdentity();

  if (!ready) {
    return <div aria-hidden className="chunk h-[3.25rem] animate-pulse rounded-xl bg-raise" />;
  }

  if (!available) {
    return (
      <div className="chunk rounded-xl bg-raise px-3 py-2.5">
        <p className="shout text-[0.6rem] text-faint">No wallet detected</p>
        <p className="mt-1 text-[0.7rem] leading-snug font-semibold text-muted">
          Install a browser wallet to scope this dashboard to your own account. Everything on it is
          readable without one.
        </p>
      </div>
    );
  }

  if (!connected || address === undefined) {
    return (
      <div className="space-y-2">
        <Button tone="pinned" size="sm" full onClick={() => void connect()} disabled={connecting}>
          {connecting ? "Waiting for wallet\u2026" : "Connect wallet"}
        </Button>
        <p className="text-[0.65rem] leading-snug font-semibold text-faint">
          Shows your approvals and lets you revoke. Approving a version stays in the CLI.
        </p>
        {error === undefined ? null : (
          <p className="text-[0.65rem] leading-snug font-bold text-revoked-ink">{error}</p>
        )}
      </div>
    );
  }

  if (!onCorrectChain) {
    return (
      <div className="pop space-y-2 rounded-xl bg-attention-tint p-2.5 [--line:var(--attention)] [--pop:var(--attention-shade)]">
        <p className="shout text-[0.6rem] text-attention-ink">Wrong network</p>
        <p className="text-[0.68rem] leading-snug font-bold text-attention-ink">
          Your wallet is on chain {chainId ?? "unknown"}. The registry is on {CHAIN_ID}, so nothing
          here would match.
        </p>
        <Button tone="attention" size="sm" full onClick={() => void switchChain()}>
          Switch to Monad testnet
        </Button>
        {error === undefined ? null : (
          <p className="text-[0.65rem] leading-snug font-bold text-revoked-ink">{error}</p>
        )}
      </div>
    );
  }

  return (
    <div className="chunk space-y-2 rounded-xl bg-raise p-2.5">
      <div className="flex items-center gap-2.5">
        {/* The account's own fingerprint, from its address. Recognisable at a glance across sessions. */}
        <div className="chunk shrink-0 rounded-lg bg-panel p-1">
          <HashFingerprint hash={fingerprintSeed(address)} tone="bonded" px={28} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="hash truncate text-[0.7rem] font-bold text-text">{shortAddress(address)}</p>
          <p className="truncate text-[0.6rem] font-semibold text-bonded-ink">Monad testnet</p>
        </div>
      </div>

      <button
        type="button"
        onClick={disconnect}
        title="Forgets this address locally. Your wallet keeps its own permission until you remove it there."
        className={cx(
          "shout press pop-sm w-full rounded-lg bg-panel px-3 py-1.5 text-[0.6rem] text-muted",
          "[--pop:var(--shade)] hover:text-text",
        )}
      >
        Forget address
      </button>
    </div>
  );
}

/**
 * Pads a 20-byte address to the 32 bytes the fingerprint expects.
 *
 * The fingerprint is a bijection over 64 hex nibbles and rejects anything shorter rather than
 * salvaging it, which is correct for hashes and means an address cannot be passed in raw.
 * Left-padding with zeros is the same widening the EVM does when it puts an address in a word, so the
 * same account always yields the same image.
 */
export function fingerprintSeed(address: string): string {
  const body = address.replace(/^0x/, "").toLowerCase();
  return `0x${body.padStart(64, "0")}`;
}
