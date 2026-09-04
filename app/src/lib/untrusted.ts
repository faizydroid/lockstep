/**
 * Validators for the two inputs this app takes from outside itself.
 *
 * `localStorage` and the URL query string have the same trust level: both are fully controlled by
 * whoever hands a reader a link or reaches this origin with a script, and neither is a place to keep
 * an assumption. `lib/settings.ts` covers storage; this covers the URL, plus the one attribute that
 * turns a string into executable code.
 *
 * ## Why a link is the interesting vector here
 *
 * React escapes text, so an arbitrary string reaching a text node is not a scripting bug. What is not
 * escaped is a URL in an `href`, because `javascript:alert(1)` in an anchor is a working script in
 * every browser. This app has a `Button` that accepts an `href` and renders an anchor, and while every
 * call site today passes a literal, "every call site today" is not a security property. `isSafeHref`
 * is, and it fails closed.
 */

/** A 32-byte hex id: pin ids, skill hashes, version ids. */
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

/**
 * A pin id from a URL, or undefined.
 *
 * Wrong values already fail harmlessly — a bogus id matches no pin and the page falls back to the
 * first one — so this is not fixing a live bug. It is refusing to hold an unbounded attacker-supplied
 * string in component state that several components read, which is the shape a real bug grows from.
 */
export function pinIdFromQuery(search: string): string | undefined {
  let value: string | null;
  try {
    value = new URLSearchParams(search).get("pin");
  } catch {
    return undefined;
  }
  if (value === null) return undefined;
  return BYTES32.test(value) ? value : undefined;
}

/**
 * Whether a string is safe to put in an `href`.
 *
 * Allows a same-document fragment, a root-relative path, and an absolute `https` URL. Everything else
 * is refused, which notably includes:
 *
 *   - `javascript:` and `data:`, the two that execute.
 *   - Scheme-relative `//evil.example`, which reads like a path and is not one.
 *   - `http:`, because this app is served over https and a downgrade in a security tool's own UI is
 *     not something to offer.
 *
 * Deliberately does not try to sanitise. A URL that does not pass is dropped and the caller renders a
 * non-link, because rewriting an attacker's URL into a slightly different attacker's URL is not a
 * defence.
 */
export function isSafeHref(href: string): boolean {
  const trimmed = href.trim();
  if (trimmed === "") return false;

  // Control characters are stripped by browsers before scheme parsing, so `java\nscript:` runs.
  // Refuse anything containing them rather than trying to normalise the way each browser does.
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return false;

  if (trimmed.startsWith("#")) return true;

  // Root-relative, but not scheme-relative. `//host` is an absolute URL wearing a path's clothes.
  if (trimmed.startsWith("/")) return !trimmed.startsWith("//");

  try {
    return new URL(trimmed).protocol === "https:";
  } catch {
    return false;
  }
}
