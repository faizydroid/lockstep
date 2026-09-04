"use client";

/**
 * Who is looking at this dashboard, which account it should show, and what may be signed.
 *
 * ## Why this is not Privy, yet
 *
 * Privy is the intended provider and PLAN.md names it. It is not what this file uses, and the reason is
 * worth recording rather than quietly working around.
 *
 * `@privy-io/react-auth@3.40.0` pulls Reown/AppKit, the Coinbase CDP SDK, Solana kit, Farcaster,
 * hono and libphonenumber. Four install attempts failed on this machine, each one leaving npm mid-reify
 * with a few hundred `.package-HASH` rollback directories in `node_modules`, which is a broken tree
 * rather than a slow one. Retrying a fifth time would have been the same bet at the same odds.
 *
 * So this implements the same contract against EIP-1193 -- the injected-provider standard every
 * browser wallet speaks -- with viem, which the app already depends on. Zero new packages.
 *
 * The trade is real and worth stating: no email login and no embedded wallets, so someone with no
 * wallet at all cannot get in. For a dashboard whose audience is developers running funded agents that
 * is an acceptable gap; for consumer onboarding it would not be.
 *
 * The seam is the point. `Identity` below is the entire surface the rest of the app sees, and swapping
 * Privy in means reimplementing this one file. Nothing else imports a wallet library, which is also
 * what keeps lib/policy.ts enforceable: the write surface is exactly what is exported here.
 *
 * ## Connecting is identity, not authority
 *
 * Signing in tells the dashboard whose approvals to show, and unlocks three narrowing writes. It does
 * not unlock approving a skill version, which is CLI-only and always will be, for the reason set out at
 * length in lib/policy.ts: a page cannot honestly attest to bytes it did not hash.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createWalletClient, custom } from "viem";
import type { Address, WalletClient } from "viem";

/** The chain this dashboard is about. Anything else is a support question waiting to happen. */
export const CHAIN_ID = 10143;

const CHAIN_HEX = `0x${CHAIN_ID.toString(16)}`;

/** What the rest of the app is allowed to know about the viewer. */
export interface Identity {
  /** A wallet provider exists in this browser. False means every action below is inert. */
  readonly available: boolean;
  /** Finished checking for an already-authorised account. */
  readonly ready: boolean;
  readonly connected: boolean;
  readonly address?: Address;
  /** Chain the wallet is currently on, when known. */
  readonly chainId?: number;
  /** Connected AND on Monad testnet. Writes require this. */
  readonly onCorrectChain: boolean;
  readonly connect: () => Promise<void>;
  /** Forgets the address locally. Wallets have no logout, so this is deliberately not called one. */
  readonly disconnect: () => void;
  readonly switchChain: () => Promise<void>;
  /** In-flight or failed connection detail, for the UI to show rather than swallow. */
  readonly error?: string;
  readonly connecting: boolean;
  /**
   * A signer for the allowed writes, or undefined.
   *
   * Undefined unless connected on the right chain, so a caller cannot accidentally send to whatever
   * network the wallet happened to be on. Returns a fresh client rather than a memoised one because the
   * account can change under it.
   */
  readonly walletClient: () => WalletClient | undefined;
}

const UNAVAILABLE: Identity = {
  available: false,
  ready: true,
  connected: false,
  onCorrectChain: false,
  connecting: false,
  connect: async () => undefined,
  disconnect: () => undefined,
  switchChain: async () => undefined,
  walletClient: () => undefined,
};

const IdentityContext = createContext<Identity>(UNAVAILABLE);

/** The subset of EIP-1193 this app uses. Narrow on purpose. */
interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: never[]) => void): void;
  removeListener?(event: string, handler: (...args: never[]) => void): void;
}

function provider(): Eip1193Provider | undefined {
  if (typeof window === "undefined") return undefined;
  const injected = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
  return injected;
}

/** Remembers that the user chose to connect, so a reload does not require clicking again. */
const STORAGE_KEY = "lockstep.wallet.connected";

const MONAD_TESTNET_PARAMS = {
  chainId: CHAIN_HEX,
  chainName: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: [process.env.NEXT_PUBLIC_RPC_URL ?? "https://testnet-rpc.monad.xyz"],
  blockExplorerUrls: ["https://testnet.monadexplorer.com"],
};

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [address, setAddress] = useState<Address | undefined>(undefined);
  const [chainId, setChainId] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [connecting, setConnecting] = useState(false);
  /*
   * Availability is state, not a computed value.
   *
   * `window.ethereum` is injected by an extension and is frequently not there on the first tick, so
   * reading it during render gives a permanent "no wallet" for users who do have one. It is read in an
   * effect instead, after the extension has had a chance to run.
   */
  const [available, setAvailable] = useState(false);

  /*
   * Restore silently with eth_accounts, never eth_requestAccounts.
   *
   * `eth_accounts` returns already-authorised accounts without a prompt. Using the requesting variant
   * here would pop a wallet dialog on every page load, which is the single most common way this
   * integration is got wrong.
   */
  useEffect(() => {
    const p = provider();
    setAvailable(p !== undefined);

    if (p === undefined) {
      setReady(true);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const wanted = window.localStorage.getItem(STORAGE_KEY) === "1";
        if (wanted) {
          const accounts = (await p.request({ method: "eth_accounts" })) as string[];
          const first = accounts[0];
          if (!cancelled && first !== undefined) setAddress(first as Address);
        }
        const hex = (await p.request({ method: "eth_chainId" })) as string;
        if (!cancelled) setChainId(Number.parseInt(hex, 16));
      } catch {
        // A wallet that refuses to answer is the same as no wallet for our purposes.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * Follow the wallet rather than assuming it stays put.
   *
   * Both events matter and both are routinely ignored. Switching account in MetaMask without
   * `accountsChanged` leaves the dashboard showing the previous account's approvals, which for this app
   * means showing the wrong answer to "what is my agent allowed to spend".
   */
  useEffect(() => {
    const p = provider();
    if (p?.on === undefined) return;

    const onAccounts = (...args: never[]) => {
      const accounts = args[0] as unknown as string[];
      const first = accounts?.[0];
      if (first === undefined) {
        setAddress(undefined);
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        setAddress(first as Address);
      }
    };

    const onChain = (...args: never[]) => {
      const hex = args[0] as unknown as string;
      setChainId(Number.parseInt(hex, 16));
    };

    p.on("accountsChanged", onAccounts);
    p.on("chainChanged", onChain);

    return () => {
      p.removeListener?.("accountsChanged", onAccounts);
      p.removeListener?.("chainChanged", onChain);
    };
  }, []);

  const connect = useCallback(async () => {
    const p = provider();
    if (p === undefined) {
      setError("No wallet found in this browser.");
      return;
    }

    setConnecting(true);
    setError(undefined);
    try {
      const accounts = (await p.request({ method: "eth_requestAccounts" })) as string[];
      const first = accounts[0];
      if (first === undefined) {
        setError("The wallet returned no accounts.");
        return;
      }
      setAddress(first as Address);
      window.localStorage.setItem(STORAGE_KEY, "1");

      const hex = (await p.request({ method: "eth_chainId" })) as string;
      setChainId(Number.parseInt(hex, 16));
    } catch (err) {
      // 4001 is the user declining, which is not an error worth shouting about.
      const code = (err as { code?: number }).code;
      setError(code === 4001 ? undefined : describe(err));
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    /*
     * Local only, and named accordingly.
     *
     * EIP-1193 has no disconnect: a dapp cannot make a wallet forget it. Calling this "sign out" would
     * imply a revocation that did not happen. It clears our stored intent so the next load does not
     * auto-restore, and the wallet's own permission remains until the user removes it there.
     */
    setAddress(undefined);
    setError(undefined);
    window.localStorage.removeItem(STORAGE_KEY);
  }, []);

  const switchChain = useCallback(async () => {
    const p = provider();
    if (p === undefined) return;

    setError(undefined);
    try {
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] });
    } catch (err) {
      // 4902 means the wallet has never heard of this chain, so offer to add it.
      const code = (err as { code?: number }).code;
      if (code === 4902) {
        try {
          await p.request({ method: "wallet_addEthereumChain", params: [MONAD_TESTNET_PARAMS] });
        } catch (addErr) {
          setError(describe(addErr));
        }
        return;
      }
      if (code !== 4001) setError(describe(err));
    }
  }, []);

  const onCorrectChain = address !== undefined && chainId === CHAIN_ID;

  const walletClient = useCallback((): WalletClient | undefined => {
    const p = provider();
    if (p === undefined || address === undefined || chainId !== CHAIN_ID) return undefined;
    return createWalletClient({ account: address, transport: custom(p) });
  }, [address, chainId]);

  const value = useMemo<Identity>(
    () => ({
      available,
      ready,
      connected: address !== undefined,
      onCorrectChain,
      connecting,
      connect,
      disconnect,
      switchChain,
      walletClient,
      ...(address !== undefined ? { address } : {}),
      ...(chainId !== undefined ? { chainId } : {}),
      ...(error !== undefined ? { error } : {}),
    }),
    [
      available,
      ready,
      address,
      chainId,
      onCorrectChain,
      connecting,
      error,
      connect,
      disconnect,
      switchChain,
      walletClient,
    ],
  );

  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message.split("\n")[0] ?? "Wallet request failed.";
  return "Wallet request failed.";
}

export function useIdentity(): Identity {
  return useContext(IdentityContext);
}
