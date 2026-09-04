"use client";

/**
 * Settings, held in one place and persisted to `localStorage`.
 *
 * Above `SnapshotProvider` in the tree, because the snapshot reads the RPC URL, the account and the
 * deploy block from here. The dependency runs one way: settings never read chain state.
 *
 * ## Why the first render uses defaults
 *
 * The app is a static export, so the HTML is generated at build time and hydrated in the browser.
 * Reading `localStorage` during render would make the first client render disagree with that HTML and
 * produce a hydration mismatch, so stored values land in an effect and `loaded` says which state you
 * are in. Anything that would look wrong for a frame — the quickstart appearing and then vanishing
 * because it had already been dismissed — checks `loaded` rather than guessing.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { DEFAULT_SETTINGS, STORAGE_KEY, parse, serialise } from "@/lib/settings";
import type { Settings } from "@/lib/settings";

interface SettingsApi {
  readonly settings: Settings;
  /** False until stored settings have been read. Guards anything that must not flash. */
  readonly loaded: boolean;
  readonly update: (patch: Partial<Settings>) => void;
  /**
   * Clears an individual override. Distinct from `update`, since `undefined` in a patch is ambiguous.
   *
   * `profile` is in here rather than only settable because it is the reader's own data sitting in their
   * own browser, and anything that can write it must be able to remove it. There is no server to ask.
   */
  readonly clear: (key: "rpcUrl" | "account" | "deployBlock" | "profile") => void;
  readonly completeStep: (id: string) => void;
  readonly reset: () => void;
}

const SettingsContext = createContext<SettingsApi | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      setSettings(parse(window.localStorage.getItem(STORAGE_KEY)));
    } catch {
      // Storage can be unavailable outright: Safari private browsing, or a browser configured to
      // block it. Defaults are a working app, so this is not worth surfacing.
    } finally {
      setLoaded(true);
    }
  }, []);

  /** Writes through, and never lets a storage failure lose the in-memory change. */
  const persist = useCallback((next: Settings) => {
    setSettings(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, serialise(next));
    } catch {
      // Quota exceeded, or storage disabled. The setting still applies for this session, which is
      // better than refusing the change because it could not be remembered.
    }
  }, []);

  const update = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((current) => {
        const next = { ...current, ...patch };
        try {
          window.localStorage.setItem(STORAGE_KEY, serialise(next));
        } catch {
          // See above.
        }
        return next;
      });
    },
    [],
  );

  /*
   * Clearing is its own operation.
   *
   * `update({ rpcUrl: undefined })` cannot express "remove this" distinctly from "leave it alone"
   * once it has been through a spread, and getting that wrong means a reader who tries to remove an
   * override silently keeps it — which is the one failure this whole module is supposed to prevent.
   */
  const clear = useCallback(
    (key: "rpcUrl" | "account" | "deployBlock" | "profile") => {
      setSettings((current) => {
        const next = { ...current };
        delete next[key];
        try {
          window.localStorage.setItem(STORAGE_KEY, serialise(next));
        } catch {
          // See above.
        }
        return next;
      });
    },
    [],
  );

  const completeStep = useCallback((id: string) => {
    setSettings((current) => {
      if (current.completedSteps.includes(id)) return current;
      const next = { ...current, completedSteps: [...current.completedSteps, id] };
      try {
        window.localStorage.setItem(STORAGE_KEY, serialise(next));
      } catch {
        // See above.
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    persist(DEFAULT_SETTINGS);
  }, [persist]);

  const value = useMemo<SettingsApi>(
    () => ({ settings, loaded, update, clear, completeStep, reset }),
    [settings, loaded, update, clear, completeStep, reset],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsApi {
  const value = useContext(SettingsContext);
  if (value === undefined) {
    throw new Error("useSettings must be used inside SettingsProvider");
  }
  return value;
}
