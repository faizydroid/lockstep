/**
 * Conditional class names.
 *
 * Moved out of `components/ui.tsx`, where it lived, to break an import cycle. `Empty` now draws the
 * mascot, so `ui.tsx` needs `guard.tsx`; `guard.tsx` needed `cx` from `ui.tsx`. ESM tolerates most
 * cycles and then fails at module-init time in a way that is very hard to read, so the shared leaf
 * moved down a layer instead.
 *
 * `ui.tsx` still re-exports it, so no call site changed.
 */
export function cx(...parts: readonly (string | false | undefined | null)[]): string {
  return parts.filter(Boolean).join(" ");
}
