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

/**
 * The literal stand-in for a skill directory in a copyable command.
 *
 * Exported as a constant so the test suite can assert that the drift page's command contains it and
 * therefore cannot contain an interpolated name. A string literal in the page would be indistinguishable
 * from a name that happened to look safe.
 */
export const SKILL_DIR_PLACEHOLDER = "your-skill";

/** How much of a publisher's chosen name is shown before it is cut. */
const NAME_LIMIT = 64;

/**
 * A publisher's skill name, made safe to render.
 *
 * ## Why a name needs this at all
 *
 * `skillName` comes out of a publisher's manifest. It is attacker-controlled in the ordinary case, not
 * the exotic one: publishing is open, and this dashboard prints the name in its largest type, directly
 * beside its own labels. React escapes it, so this is not about scripting. It is about a name being able
 * to lie about its own shape:
 *
 *   - A right-to-left override (U+202E) reverses how the rest of the string renders, so the name on
 *     screen can be arbitrarily different from the name in the bytes that were hashed.
 *   - Zero-width characters let two different publishers' skills render identically, which is the whole
 *     attack this product exists to make expensive, executed one layer up in the interface.
 *   - Newlines and runs of whitespace break the card they sit in, and a 4,000-character name destroys
 *     every layout on the page.
 *
 * ## Why this sanitises where `isSafeHref` refuses
 *
 * `isSafeHref` drops what it cannot vouch for, because a link that does not work is a fine outcome. A
 * name cannot be dropped -- something has to render -- so the rule here is different: strip the
 * characters that let a string misrepresent itself, bound the length, and never let the result stand as
 * identity. The hash and the fingerprint beside it are the identity. That is why this is a display
 * helper and nothing compares names.
 *
 * What it deliberately does NOT attempt is homoglyph or lookalike detection. Deciding that "kuru" and
 * "kurу" are confusable is a policy call with false positives, it belongs on the publishing side rather
 * than the viewing side, and a half-working version would imply a guarantee that is not there.
 */
export function displayName(raw: string | undefined, fallback = "unnamed skill"): string {
  if (raw === undefined) return fallback;

  const cleaned = raw
    /*
     * Whitespace controls become a space; every other control is removed.
     *
     * The order matters and the first version got it wrong by deleting both. A tab between two words
     * joined them -- "price\toracle" rendered as "priceoracle" -- which changes the name and hands back a
     * collision: two different stored names painting identical pixels is the thing this function exists to
     * prevent. Tab, newline, carriage return, vertical tab and form feed are word separators, so they
     * collapse rather than vanish.
     */
    .replace(/[\u0009-\u000d]/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    // Bidi controls: LRE, RLE, PDF, LRO, RLO, LRM, RLM, ALM, and the isolates.
    .replace(/[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/g, "")
    // Zero-width space, non-joiner, joiner, word joiner, BOM, and the invisible maths operators.
    .replace(/[\u200b-\u200d\u2060-\u2064\ufeff]/g, "")
    // Anything the Unicode tables call a format character and everything unassigned.
    .replace(/\p{Cf}|\p{Cn}/gu, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned === "") return fallback;
  if (cleaned.length <= NAME_LIMIT) return cleaned;

  // Cut rather than wrap. A name long enough to need this is not communicating anything past 64 chars,
  // and the ellipsis is the honest signal that something was removed.
  return `${cleaned.slice(0, NAME_LIMIT).trimEnd()}\u2026`;
}
