/**
 * The checks `check-export.mjs` runs against the built dashboard, as functions of plain data.
 *
 * Split out so they can be tested. `check-export.mjs` reads the real `app/out` and exits the process,
 * which is the right shape for a build gate and the wrong one for a test, and a gate that has never
 * been shown a bad build is a gate nobody knows can fail. It could not, in two ways, until these were
 * written down as tests:
 *
 *   - The write-boundary check looked for one spelling of one thing, an ABI object with
 *     `name:"approvePin"`. The same fragment written as a human-readable string
 *     (`"function approvePin(bytes32 pinId)"`), or only the 4-byte selector in hand-built calldata,
 *     passed.
 *   - The header check was `includes("x-frame-options:")` over the whole file. A `_headers` whose
 *     `X-Frame-Options` was `ALLOWALL`, whose referrer policy was `unsafe-url`, whose CSP said
 *     `frame-ancestors *`, and which merely mentioned the right words in a comment, passed.
 *
 * This is defence in depth, not the boundary. The boundary is that the client has no ABI fragment to
 * encode these calls from (see `app/src/lib/policy.ts`); this gate notices if that stops being true.
 */

import { toFunctionSelector } from "viem";

import { SECURITY_HEADERS } from "./security-headers.mjs";

/**
 * Writes that assert a fact about bytes on a disk, and so must never be encodable in a browser.
 * Canonical signatures, so the selectors can be derived rather than transcribed; a test compares them
 * with the compiled contracts.
 */
export const FORBIDDEN_WRITES = {
  approvePin: "approvePin(bytes32)",
  publish: "publish((string,string,bytes32,uint256,address[],bytes4[]))",
  execute: "execute(bytes32,bytes32,(address,uint256,bytes)[])",
};

/** Writes the dashboard is allowed to send, which must actually be wired or its buttons do nothing. */
export const WIRED_WRITES = ["unapprovePin", "revokeExecutor", "slashEquivocation"];

/** An ABI fragment's name field, tolerating minified spacing, either quote style, and a quoted key (JSON). */
const namedFragment = (fn) => new RegExp(`["']?name["']?\\s*:\\s*["']${fn}["']`);

/** A human-readable ABI entry, as `parseAbi(["function approvePin(bytes32 pinId)"])` writes it. */
const readableFragment = (fn) => new RegExp(`function\\s+${fn}\\s*\\(`);

/**
 * A 4-byte selector at the start of a token, optionally `0x`-prefixed.
 *
 * Bounded on the left only. Calldata is the selector immediately followed by its argument words, so a
 * right-hand boundary would miss exactly the case that matters (`0x83b33879000000...`). The left
 * boundary is what keeps these eight digits from being matched as a slice of some longer constant:
 * crypto libraries carry plenty of hex, and a slice would be noise.
 */
const selectorToken = (selector) =>
  new RegExp(`(?<![0-9a-fA-F])(?:0x)?${selector.replace(/^0x/, "")}`, "i");

/**
 * For each forbidden write, the evidence in the bundle that it can be encoded. Empty means absent.
 *
 * @param {string} bundle every emitted JS chunk, concatenated
 * @returns {{ fn: string, evidence: string[] }[]}
 */
export function forbiddenWriteEvidence(bundle) {
  return Object.entries(FORBIDDEN_WRITES).map(([fn, signature]) => {
    const evidence = [];
    if (namedFragment(fn).test(bundle)) evidence.push(`ABI fragment with name "${fn}"`);
    if (readableFragment(fn).test(bundle)) evidence.push(`human-readable fragment "function ${fn}("`);
    const selector = toFunctionSelector(signature);
    if (selectorToken(selector).test(bundle)) evidence.push(`selector ${selector}`);
    return { fn, evidence };
  });
}

/** For each allowed write, whether its ABI fragment reached the bundle. */
export function wiredWritesPresent(bundle) {
  return WIRED_WRITES.map((fn) => ({ fn, present: namedFragment(fn).test(bundle) }));
}

/**
 * Parses Cloudflare's `_headers` format into rules.
 *
 * A rule is a path pattern on an unindented line followed by indented `Name: value` lines, and
 * `! Name` detaches a header an earlier rule set. Blank lines and `#` comments are dropped, so a
 * comment that happens to contain a header name or a policy is not mistaken for one.
 *
 * @returns {Map<string, ({ name: string, value: string } | { detach: string })[]>}
 */
export function parseHeadersFile(raw) {
  const rules = new Map();
  let current = null;
  for (const line of raw.split(/\r?\n/)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    if (/^\S/.test(line)) {
      current = line.trim();
      if (!rules.has(current)) rules.set(current, []);
      continue;
    }
    if (current === null) continue;
    const text = line.trim();
    if (text.startsWith("!")) {
      rules.get(current).push({ detach: text.slice(1).trim().toLowerCase() });
      continue;
    }
    const colon = text.indexOf(":");
    if (colon <= 0) continue;
    rules.get(current).push({
      name: text.slice(0, colon).trim().toLowerCase(),
      value: text.slice(colon + 1).trim(),
    });
  }
  return rules;
}

/** The fingerprinted-asset rule, which has to replace `no-store` and not be joined to it. */
const STATIC_PATTERN = "/_next/static/*";
const STATIC_CACHE = "public, max-age=31536000, immutable";

/**
 * Compares a `_headers` file with the policy this project defines.
 *
 * Exact values, under the `/*` rule. Presence of a name is not enough: `X-Frame-Options: ALLOWALL`
 * contains the right words and permits framing. Cloudflare applies every matching rule and joins a
 * repeated header with a comma, so another rule setting a security header is not an override of the
 * `/*` rule but an addition to it, and is reported.
 *
 * @returns {{ lines: string[], problems: string[] }}
 */
export function auditHeadersFile(raw) {
  const rules = parseHeadersFile(raw);
  const lines = [];
  const problems = [];
  const all = rules.get("/*");

  if (all === undefined) {
    problems.push("_headers has no `/*` rule, so the headers apply to nothing");
  }

  for (const [name, expected] of Object.entries(SECURITY_HEADERS)) {
    const label = name.padEnd(28);
    const found = (all ?? []).filter((entry) => entry.name === name);
    if (found.length === 0) {
      lines.push(`  ${label} MISSING`);
      problems.push(`_headers does not send ${name}`);
    } else if (found.length > 1 || found[0].value !== expected) {
      lines.push(`  ${label} WRONG VALUE`);
      problems.push(
        `_headers sends ${name} as "${found.map((entry) => entry.value).join('", "')}", ` +
          `not the defined "${expected}"`,
      );
    } else {
      lines.push(`  ${label} ok`);
    }
  }

  for (const [pattern, entries] of rules) {
    if (pattern === "/*") continue;
    for (const entry of entries) {
      if (entry.name !== undefined && entry.name in SECURITY_HEADERS) {
        problems.push(
          `_headers rule ${pattern} also sets ${entry.name}; Cloudflare joins it to the /* value ` +
            `rather than replacing it`,
        );
      }
    }
  }

  const staticRule = rules.get(STATIC_PATTERN) ?? [];
  const detaches = staticRule.some((entry) => entry.detach === "cache-control");
  const caches = staticRule.some((entry) => entry.name === "cache-control" && entry.value === STATIC_CACHE);
  lines.push(`  ${"static cache override".padEnd(28)} ${detaches && caches ? "ok" : "MISSING"}`);
  if (!detaches || !caches) {
    problems.push(
      "_headers does not detach cache-control on /_next/static/* and set it to " +
        `"${STATIC_CACHE}", so Cloudflare merges in the /* rule's no-store and fingerprinted assets ` +
        "are never cached",
    );
  }

  return { lines, problems };
}
