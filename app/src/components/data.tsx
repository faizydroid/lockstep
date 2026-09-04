"use client";

/**
 * One snapshot, loaded once, shared by every page.
 *
 * The app is a static export, so there is no server to fetch on. Reads happen in the browser,
 * and rebuilding every pin from logs is expensive enough that doing it per page would be
 * visible. So it happens once behind a context.
 *
 * Loading state is modelled explicitly rather than as `undefined`, because "still loading" and
 * "loaded, and genuinely empty" must not render the same way. An empty pin list is a real
 * answer worth showing plainly; a spinner that never resolves is a bug pretending to be one.
 */

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { loadSnapshot, readConfig } from "@/lib/chain";
import { sampleSnapshot } from "@/lib/fixtures";
import type { Snapshot } from "@/lib/model";

import { useIdentity } from "./identity";
import { useSettings } from "./settings";

type State =
  | { readonly status: "loading"; readonly snapshot: Snapshot }
  | { readonly status: "ready"; readonly snapshot: Snapshot };

const SnapshotContext = createContext<State | undefined>(undefined);

export function SnapshotProvider({ children }: { children: ReactNode }) {
  /*
   * Seeded with sample data rather than nothing.
   *
   * The first paint therefore shows a complete, laid-out interface instead of a page of
   * skeletons that reflows once. The banner says `loading` until the real read lands, so the
   * figures are never passed off as live, and if there is no registry configured this is
   * already the final answer.
   */
  const [state, setState] = useState<State>({
    status: "loading",
    snapshot: sampleSnapshot("Reading chain state\u2026"),
  });

  /*
   * A connected wallet overrides the configured account.
   *
   * This is the entire point of signing in: approvals and executions live in the account's own
   * storage under EIP-7702, so "whose approvals am I looking at" is answered by an address and nothing
   * else. Without a connection the build's `NEXT_PUBLIC_ACCOUNT_ADDRESS` stands, which is what makes
   * the deployed demo show something rather than an empty shell.
   *
   * Note this only changes the account-scoped reads. Registry-wide figures -- pins, publishers, bond
   * totals -- are the same for everyone and do not depend on who is looking.
   */
  const { address, ready } = useIdentity();

  /*
   * Settings override the build's configuration, and a connected wallet overrides both.
   *
   * The precedence is deliberate and it is the order of how specific each source is about *whose*
   * view this is. The build ships a default account so a visitor sees something real; a setting is a
   * reader deliberately looking at some other address; a connected wallet is the strongest statement
   * of all, because the person is holding the key.
   *
   * `settingsLoaded` is waited on for the same reason `ready` is: firing the first read against the
   * build's RPC and then immediately redoing it against an overridden one doubles every request on a
   * rate-limited endpoint, which is the specific way this page falls back to sample data.
   */
  const { settings, loaded: settingsLoaded } = useSettings();

  useEffect(() => {
    // Wait for the session to restore, or the first read fires with no address and is then redone.
    if (!ready || !settingsLoaded) return;

    let cancelled = false;

    void (async () => {
      const base = readConfig();
      const config = {
        ...base,
        ...(settings.rpcUrl === undefined ? {} : { rpcUrl: settings.rpcUrl }),
        ...(settings.deployBlock === undefined ? {} : { deployBlock: settings.deployBlock }),
        ...(settings.account === undefined ? {} : { account: settings.account }),
        ...(address === undefined ? {} : { account: address }),
      };
      const snapshot = await loadSnapshot(config);
      if (!cancelled) setState({ status: "ready", snapshot });
    })();

    return () => {
      cancelled = true;
    };
  }, [address, ready, settingsLoaded, settings.rpcUrl, settings.deployBlock, settings.account]);

  return <SnapshotContext.Provider value={state}>{children}</SnapshotContext.Provider>;
}

export function useSnapshot(): State {
  const state = useContext(SnapshotContext);
  if (state === undefined) {
    throw new Error("useSnapshot must be used inside SnapshotProvider");
  }
  return state;
}
