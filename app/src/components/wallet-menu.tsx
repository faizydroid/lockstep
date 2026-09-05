"use client";

/**
 * The wallet control, top right, as a dropdown.
 *
 * ## Why this shape and not the one it replaces
 *
 * The identity control used to be a stacked panel at the foot of a 272px left rail: an address, a
 * fingerprint, four paragraphs of copy about what connecting does and does not do, and a "Forget address"
 * button. All of it visible at all times, on every page.
 *
 * That is not how a dashboard in this category works, and the convention is worth following rather than
 * reinventing. Every wallet-connected dashboard a reader has used puts the account top right, collapsed to
 * an identicon and a truncated address with a chevron, and puts the detail behind it: the full address, the
 * network, an explorer link, and disconnect. A reader arriving here already knows where to look and what a
 * chevron next to `0x209C…aFF2` will do. Spending that familiarity to be different is a cost with no return.
 *
 * The four paragraphs of priming did not survive, and they should not have. They exist to be read *before*
 * a first connection, which is the landing page's job and where `StartHere` already says all of it. Repeating
 * it permanently in the chrome of every page meant a returning reader paid for it on every visit.
 *
 * ## What is kept that a generic wallet menu would not have
 *
 * Whether anything is enforcing this account's approvals. It is the one fact this product exists to surface
 * and it belongs next to the address, because "connected" and "protected" are different things here: a
 * delegation can be moved elsewhere while every approval stays in storage, unread, looking exactly as it did.
 *
 * And the wrong-network state gets the whole button rather than a line inside the menu. On the wrong chain
 * every read is against a registry that does not exist there, so the honest presentation is that nothing on
 * screen means anything until it is fixed — not a quiet note behind a chevron.
 */

import { useEffect, useRef, useState } from "react";

import { explorerTxUrl, readConfig } from "@/lib/chain";
import { shortAddress } from "@/lib/format";

import { fingerprintSeed } from "./account-control";
import { HashFingerprint } from "./fingerprint";
import { CHAIN_ID, useIdentity } from "./identity";
import { useSnapshot } from "./data";
import { Button, cx } from "./ui";

export function WalletMenu() {
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

  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onDown = (event: PointerEvent) => {
      if (wrap.current !== null && !wrap.current.contains(event.target as Node)) setOpen(false);
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  /*
   * A fixed-width placeholder while the session restores, not nothing.
   *
   * The silent `eth_accounts` check takes a moment, and rendering nothing then a button shifts the whole
   * navbar sideways after paint — on the element a reader is most likely to be reaching for.
   */
  if (!ready) {
    return <div aria-hidden className="chunk h-9 w-28 animate-pulse rounded-md bg-raise" />;
  }

  if (!available) {
    return (
      <span
        title="Install a browser wallet to scope this dashboard to your own account. Everything on it is readable without one."
        className="shout hidden rounded-md border border-line px-3 py-2 text-label text-faint sm:inline-block"
      >
        No wallet
      </span>
    );
  }

  if (!connected || address === undefined) {
    return (
      <Button tone="pinned" size="sm" onClick={() => void connect()} disabled={connecting}>
        {connecting ? "Check wallet\u2026" : "Connect wallet"}
      </Button>
    );
  }

  /*
   * The wrong chain takes the button, not a line in the menu.
   *
   * Every read on the page is against a registry that does not exist on the connected chain, so the whole
   * dashboard is meaningless until this is resolved. Hiding that behind a chevron would leave a reader
   * looking at an empty registry and concluding the product is empty.
   */
  if (!onCorrectChain) {
    return (
      <Button tone="attention" size="sm" onClick={() => void switchChain()}>
        Wrong network &middot; switch
      </Button>
    );
  }

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cx(
          "press chunk inline-flex h-9 items-center gap-2 rounded-md bg-panel pl-1.5 pr-2.5",
          open && "bg-raise",
        )}
      >
        {/* The account's own fingerprint. Recognisable at a glance, and it survives a truncated address. */}
        <span aria-hidden className="shrink-0 rounded bg-raise p-0.5">
          <HashFingerprint hash={fingerprintSeed(address)} tone="bonded" px={20} />
        </span>
        <span className="hash text-label text-text">{shortAddress(address)}</span>
        <Chevron open={open} />
      </button>

      {open ? <Menu address={address} chainId={chainId} onDisconnect={disconnect} error={error} /> : null}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={cx("size-3.5 shrink-0 text-faint transition-transform", open && "rotate-180")}
      fill="none"
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function Menu({
  address,
  chainId,
  onDisconnect,
  error,
}: {
  address: string;
  chainId: number | undefined;
  onDisconnect: () => void;
  error: string | undefined;
}) {
  const { snapshot } = useSnapshot();
  const [copied, setCopied] = useState(false);

  /*
   * The enforcement verdict, which is why this menu is not a generic one.
   *
   * `pointedAtConfiguredGuard` and a confirmed guard are two separate checks that can disagree, and the
   * disagreement is the finding: an account can carry a valid 7702 delegation pointing at something that is
   * not this guard, with every approval still sitting in storage unread.
   */
  const account = snapshot.account;
  const enforced =
    account !== undefined && account.guard.kind === "confirmed" && account.pointedAtConfiguredGuard;
  const sameAccount = account?.address.toLowerCase() === address.toLowerCase();

  const explorer = explorerTxUrl("", readConfig())?.replace(/\/tx\/$/, `/address/${address}`);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard can be refused. The address is on screen and selectable either way.
    }
  };

  return (
    <div
      role="menu"
      /*
       * Right-aligned and width-capped against the viewport. Anchored to a control at the right edge, a
       * fixed-width panel is the classic way a dropdown ends up half off a phone screen.
       */
      className="chunk absolute right-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-md bg-panel"
    >
      <div className="border-b border-line p-3">
        <p className="shout text-label text-faint">Connected account</p>
        <p className="hash mt-1.5 break-all text-note text-text">{address}</p>

        <div className="mt-2.5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void copy()}
            className="press chunk rounded px-2 py-1 text-label text-muted hover:text-text"
          >
            {copied ? "Copied" : "Copy address"}
          </button>
          {explorer === undefined ? null : (
            <a
              href={explorer}
              target="_blank"
              rel="noreferrer noopener"
              className="press chunk rounded px-2 py-1 text-label text-muted hover:text-text"
            >
              Explorer &rarr;
            </a>
          )}
        </div>
      </div>

      <dl className="divide-y divide-line text-note">
        <Row label="Network">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-1.5 rounded-pill bg-bonded" />
            <span className="hash text-label text-text">
              {chainId === 143 ? "Monad mainnet" : `Monad testnet · ${chainId ?? CHAIN_ID}`}
            </span>
          </span>
        </Row>

        <Row label="Enforcing">
          {/*
            Three answers, not two. "We have not read this account" is different from "nothing is enforcing
            it", and collapsing them would report a false negative for the duration of every chain read.
          */}
          {account === undefined || !sameAccount ? (
            <span className="hash text-label text-faint">not read yet</span>
          ) : enforced ? (
            <span className="hash text-label text-bonded-ink">LockstepGuard</span>
          ) : (
            <span className="hash text-label text-revoked-ink">nothing</span>
          )}
        </Row>
      </dl>

      {error === undefined ? null : (
        <p className="border-t border-line px-3 py-2 text-label text-revoked-ink">{error}</p>
      )}

      <div className="border-t border-line p-2">
        <button
          type="button"
          role="menuitem"
          onClick={onDisconnect}
          className="press w-full rounded px-2 py-1.5 text-left text-note text-revoked-ink hover:bg-revoked-tint"
        >
          Disconnect
        </button>
        {/*
          Says what it does and what it cannot do.

          It used to read "Forget address", which was accurate about our storage and silent about the two
          things a reader actually wants to know: the wallet keeps its own permission either way, and the
          dashboard stops being scoped to this account. The second half was not even true until this pass —
          see the note in `identity.tsx`.
        */}
        <p className="px-2 pb-1 pt-1.5 text-label leading-snug text-faint">
          Stops this dashboard reading your account and clears the stored address. Your wallet keeps its own
          permission until you remove it there.
        </p>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <dt className="shout text-label text-faint">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
