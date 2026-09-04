"use client";

/**
 * Theme control: light, dark, or follow the system.
 *
 * Three states rather than two, because the two-state version forces a choice on someone who
 * already expressed one at the OS level. Anybody who never touches this gets their system
 * preference and keeps it when they change it; anybody who overrides gets an override that
 * persists.
 *
 * The class is applied by a blocking script in the document head, not here. React runs after
 * first paint, so doing it in an effect means a white flash on a dark-mode machine every single
 * load -- the one bug every dark mode implementation ships at least once.
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

export type ThemeChoice = "light" | "dark" | "system";
export type Resolved = "light" | "dark";

const STORAGE_KEY = "lockstep-theme";

/**
 * Runs before first paint, inlined into <head>.
 *
 * Kept in one string so the markup and this module cannot drift apart, and written defensively:
 * localStorage throws outright in some privacy modes, and a theme script that throws leaves the
 * page unstyled. Failing to the system preference is always safe.
 */
export const THEME_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('${STORAGE_KEY}');
    var choice = stored === 'light' || stored === 'dark' ? stored : 'system';
    var dark = choice === 'dark' ||
      (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) {
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', !!prefersDark);
  }
})();
`.trim();

interface ThemeState {
  readonly choice: ThemeChoice;
  readonly resolved: Resolved;
  readonly setChoice: (next: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeState | undefined>(undefined);

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function apply(resolved: Resolved): void {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  /*
   * Both start at "light" during server render and are corrected on mount.
   *
   * The prerendered HTML has no user, so any guess here would be wrong half the time and would
   * trip hydration. The real value is already on the <html> element by the time React runs --
   * the head script put it there -- so mounting reads it back rather than deciding it.
   */
  const [choice, setChoiceState] = useState<ThemeChoice>("system");
  const [resolved, setResolved] = useState<Resolved>("light");

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      // Storage can be unavailable. Following the system is the right fallback.
    }
    const initial: ThemeChoice = stored === "light" || stored === "dark" ? stored : "system";
    setChoiceState(initial);
    setResolved(
      initial === "system" ? (systemPrefersDark() ? "dark" : "light") : initial,
    );
  }, []);

  /*
   * Follow the OS live, but only while the choice is "system".
   *
   * Someone who has explicitly picked light should not be flipped when their machine switches at
   * sunset -- that is precisely the override they asked for.
   */
  useEffect(() => {
    if (choice !== "system") return;

    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => {
      const next: Resolved = event.matches ? "dark" : "light";
      setResolved(next);
      apply(next);
    };

    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);

    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // A theme that cannot be persisted should still apply for this session.
    }

    const effective: Resolved = next === "system" ? (systemPrefersDark() ? "dark" : "light") : next;
    setResolved(effective);
    apply(effective);
  }, []);

  return (
    <ThemeContext.Provider value={{ choice, resolved, setChoice }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeState {
  const state = useContext(ThemeContext);
  if (state === undefined) throw new Error("useTheme must be used inside ThemeProvider");
  return state;
}
