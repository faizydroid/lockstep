/**
 * The one definition of the dashboard's security headers.
 *
 * Two consumers, and the reason they share this file rather than each keeping a copy is the whole
 * point of it:
 *
 *   - `scripts/serve-export.mjs` sends them, and is the local reference for what a real deploy
 *     should configure.
 *   - `scripts/write-cloudflare-headers.mjs` compiles them into `app/out/_headers`, which is how
 *     Cloudflare Pages actually serves them in production.
 *
 * Before this file existed, the reference server was the only place the headers were written down,
 * and `app/src/app/layout.tsx` carried a `<meta>` CSP that is *not* equivalent to it. That left the
 * deployed site's real headers as whatever the host happened to default to — which for a static host
 * is nothing. A local server proving that six headers are correct, while the public deployment sends
 * none of them, is worse than no local server: it produces evidence for a claim that is false where
 * it matters.
 *
 * ## Three of these cannot be expressed in markup at all
 *
 * `frame-ancestors`, `X-Frame-Options` and `Referrer-Policy` are header-only. The `<meta>` CSP in
 * `layout.tsx` omits `frame-ancestors` deliberately rather than declaring a directive a browser
 * would ignore there. So the `_headers` file is not belt-and-braces over the meta tag; it is the
 * only thing that delivers those three, and `scripts/check-export.mjs` fails the build if it is
 * missing or has lost one of them.
 *
 * ## The CSP is honest about its own weakness
 *
 * `script-src` needs `'unsafe-inline'` because Next inlines its bootstrap and this app inlines a
 * pre-paint theme script, and a static export cannot use nonces — a nonce has to be minted per
 * response and there are no responses to mint it in. So this is not XSS-proof and does not claim to
 * be. What it does buy is real: `object-src 'none'` kills plugin embeds, `base-uri 'none'` blocks
 * base-tag injection (which would silently repoint every relative URL on the page), `form-action
 * 'none'` matters because there are no forms so any that appear are not ours, and
 * `frame-ancestors 'none'` stops the dashboard being framed by a page that wants a reader to think
 * they are approving something.
 *
 * `connect-src` allows `https:` broadly rather than pinning the RPC host, because settings let a
 * reader supply their own endpoint. Pinning it would break that on purpose; the compensating control
 * is that an override is disclosed in the source bar on every page.
 */
export const SECURITY_HEADERS = {
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' https:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; "),
  // Stops a browser guessing that a .txt is HTML, which is how a text file becomes a script.
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  // No URL leaves this origin in a Referer. Pin ids and account addresses live in these URLs.
  "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin",
  // No reason for a read-only dashboard to be able to ask for any of these.
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};

/**
 * The header names a static host must send because markup cannot express them.
 *
 * Read by `check-export.mjs`. Kept beside the definition so adding a header-only protection here
 * cannot silently escape the check.
 */
export const HEADER_ONLY = ["x-frame-options", "referrer-policy"];

/** CSP directives that only work in a real header, so their presence in `_headers` is load-bearing. */
export const HEADER_ONLY_CSP_DIRECTIVES = ["frame-ancestors 'none'"];
