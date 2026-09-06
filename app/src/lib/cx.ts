/**
 * Conditional class names.
 *
 * Moved out of `components/ui.tsx`, where it lived, to break an import cycle: `Empty` drew the mascot,
 * so `ui.tsx` needed `guard.tsx`, and `guard.tsx` needed `cx` from `ui.tsx`. ESM tolerates most cycles
 * and then fails at module-init time in a way that is very hard to read, so the shared leaf moved down
 * a layer instead.
 *
 * The mascot has since been deleted and that cycle no longer exists, so this could move back. It has not,
 * because a leaf with no dependencies is the right shape for something half the app imports, and the next
 * component that needs `cx` and is also needed by `ui.tsx` would recreate the cycle exactly.
 *
 * `ui.tsx` still re-exports it, so no call site changed.
 */
export function cx(...parts: readonly (string | false | undefined | null)[]): string {
  return parts.filter(Boolean).join(" ");
}
