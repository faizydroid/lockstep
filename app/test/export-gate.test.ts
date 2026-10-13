/**
 * The build gate and the preview server, shown bad input.
 *
 * `check-export.mjs` is the only thing standing between a change and a dashboard that can encode
 * `approvePin`, or one served with its protections gutted, and `serve-export.mjs` is the reference for
 * what a real deploy should send. Neither had ever been shown a bad build. An audit did, and four
 * ways past the gate and one way to crash the server came out in an afternoon:
 *
 *   - the write-boundary check knew one spelling of one thing (an ABI object with `name:"approvePin"`);
 *     a human-readable fragment, or only the 4-byte selector in hand-built calldata, passed;
 *   - the header check was `includes("x-frame-options:")` over the whole file, so `ALLOWALL`,
 *     `unsafe-url`, `frame-ancestors *`, and a comment that merely mentioned the right words, passed;
 *   - `GET /%` made `decodeURIComponent` throw inside the request handler and ended the process.
 *
 * Each case below fails against the code it replaced.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { toFunctionSelector } from "viem";

import {
  FORBIDDEN_WRITES,
  auditHeadersFile,
  forbiddenWriteEvidence,
  parseHeadersFile,
  wiredWritesPresent,
} from "../../scripts/export-checks.mjs";
import { fileFor } from "../../scripts/export-paths.mjs";
import { SECURITY_HEADERS } from "../../scripts/security-headers.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");

describe("the forbidden writes are the real functions", () => {
  const artifact = (contract: string): Record<string, string> | undefined => {
    const path = join(ROOT, "contracts", "out", `${contract}.sol`, `${contract}.json`);
    if (!existsSync(path)) return undefined;
    return (JSON.parse(readFileSync(path, "utf8")) as { methodIdentifiers: Record<string, string> })
      .methodIdentifiers;
  };
  const registry = artifact("PinRegistry");
  const guard = artifact("LockstepGuard");

  // The compiled contracts exist wherever the other contract-reading tests run (CI builds them first).
  // Skipped rather than failed where they have not been built, with the reason in the title.
  it.skipIf(registry === undefined || guard === undefined)(
    "each signature hashes to the selector the compiled contract exposes",
    () => {
      expect(registry![FORBIDDEN_WRITES.publish]).toBe(toFunctionSelector(FORBIDDEN_WRITES.publish).slice(2));
      expect(guard![FORBIDDEN_WRITES.approvePin]).toBe(toFunctionSelector(FORBIDDEN_WRITES.approvePin).slice(2));
      expect(guard![FORBIDDEN_WRITES.execute]).toBe(toFunctionSelector(FORBIDDEN_WRITES.execute).slice(2));
    },
  );

  it("are the three that assert a fact about bytes", () => {
    expect(Object.keys(FORBIDDEN_WRITES).sort()).toEqual(["approvePin", "execute", "publish"]);
  });
});

describe("the write-boundary check", () => {
  const evidenceFor = (bundle: string) =>
    Object.fromEntries(forbiddenWriteEvidence(bundle).map(({ fn, evidence }) => [fn, evidence]));

  // What the real bundle carries: the narrowing writes, and nothing that asserts a fact about bytes.
  const CLEAN = [
    'const a={type:"function",name:"unapprovePin",inputs:[{name:"pinId",type:"bytes32"}]};',
    'const b={type:"function",name:"revokeExecutor"};const c={type:"function",name:"slashEquivocation"};',
    'const d="0x095ea7b3",e="0xa9059cbb",h="0x8b7a0c3f2d9e41a6b5c4d3e2f1a09b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a";',
  ].join("\n");

  it("finds nothing in a bundle that carries only the allowed writes", () => {
    expect(evidenceFor(CLEAN)).toEqual({ approvePin: [], publish: [], execute: [] });
  });

  it("does not mistake unapprovePin for approvePin", () => {
    const bundle = 'x={name:"unapprovePin"}; y="function unapprovePin(bytes32 pinId)";';
    expect(evidenceFor(bundle).approvePin).toEqual([]);
  });

  it("finds an ABI object with the function's name, in either quote style, minified or as JSON", () => {
    expect(evidenceFor('x={name:"approvePin"}').approvePin).toHaveLength(1);
    expect(evidenceFor("x={ name : 'publish' }").publish).toHaveLength(1);
    expect(evidenceFor('JSON.parse(\'{"type":"function","name":"execute"}\')').execute!.join()).toMatch(/ABI fragment/);
  });

  it("finds a human-readable fragment, which the object-only check let through", () => {
    const bundle = 'parseAbi(["function approvePin(bytes32 pinId)","function execute(bytes32 a, bytes32 b, (address,uint256,bytes)[] c)"])';
    const found = evidenceFor(bundle);
    expect(found.approvePin!.join()).toMatch(/human-readable/);
    expect(found.execute!.join()).toMatch(/human-readable/);
  });

  it("finds the bare selector in hand-built calldata, with or without 0x", () => {
    for (const [fn, signature] of Object.entries(FORBIDDEN_WRITES)) {
      const selector = toFunctionSelector(signature);
      expect(evidenceFor(`send({data:"${selector}${"00".repeat(32)}"})`)[fn]!.join(), fn).toMatch(/selector/);
      expect(evidenceFor(`const s="${selector.slice(2)}"`)[fn]!.join(), fn).toMatch(/selector/);
    }
  });

  it("ignores those eight hex digits when they are only a slice of a longer constant", () => {
    const selector = toFunctionSelector(FORBIDDEN_WRITES.approvePin).slice(2);
    expect(evidenceFor(`const k="deadbeef${selector}cafef00d"`).approvePin).toEqual([]);
  });

  it("reports the allowed writes as present only when their fragments are", () => {
    expect(wiredWritesPresent(CLEAN).every((entry) => entry.present)).toBe(true);
    expect(wiredWritesPresent("nothing here").every((entry) => !entry.present)).toBe(true);
  });
});

describe("the _headers check", () => {
  /** The file `write-cloudflare-headers.mjs` writes, built from the same definition. */
  const rule = (pattern: string, headers: Record<string, string>, detach: string[] = []) =>
    [pattern, ...detach.map((name) => `  ! ${name}`), ...Object.entries(headers).map(([k, v]) => `  ${k}: ${v}`)].join("\n");
  const GOOD = [
    "# Generated by scripts/write-cloudflare-headers.mjs. Do not edit.",
    "",
    rule("/*", { ...SECURITY_HEADERS, "cache-control": "no-store" }),
    "",
    rule("/_next/static/*", { "cache-control": "public, max-age=31536000, immutable" }, ["cache-control"]),
    "",
  ].join("\n");

  const withHeader = (text: string, name: string, value: string) =>
    text.replace(new RegExp(`^(  ${name}): .*$`, "m"), `$1: ${value}`);

  it("accepts the generated file", () => {
    const { problems } = auditHeadersFile(GOOD);
    expect(problems).toEqual([]);
  });

  it("accepts it with Windows line endings", () => {
    expect(auditHeadersFile(GOOD.replace(/\n/g, "\r\n")).problems).toEqual([]);
  });

  it("refuses a header that is present with a weaker value", () => {
    for (const [name, bad] of [
      ["x-frame-options", "ALLOWALL"],
      ["referrer-policy", "unsafe-url"],
      ["content-security-policy", "default-src *; frame-ancestors *"],
      ["strict-transport-security", "max-age=0"],
      ["x-content-type-options", "sniff"],
    ] as const) {
      const { problems } = auditHeadersFile(withHeader(GOOD, name, bad));
      expect(problems.join("\n"), name).toContain(name);
    }
  });

  it("is not satisfied by a comment that contains the right words", () => {
    // Every real header removed, and a comment carrying each expected name and value.
    const gutted = [
      "# x-frame-options: DENY",
      "# referrer-policy: no-referrer",
      "# content-security-policy: " + SECURITY_HEADERS["content-security-policy"],
      "/*",
      "  # frame-ancestors 'none'",
      "  cache-control: no-store",
      "",
    ].join("\n");
    const { problems } = auditHeadersFile(gutted);
    expect(problems.join("\n")).toContain("does not send x-frame-options");
    expect(problems.join("\n")).toContain("does not send referrer-policy");
    expect(problems.join("\n")).toContain("does not send content-security-policy");
  });

  it("refuses a file with no /* rule, however good its other rules are", () => {
    const noWildcard = GOOD.replace("\n/*\n", "\n/index.html\n");
    expect(auditHeadersFile(noWildcard).problems.join("\n")).toContain("no `/*` rule");
  });

  it("refuses a second rule that sets a security header, since Cloudflare joins it to the first", () => {
    const extra = `${GOOD}\n/embed/*\n  x-frame-options: ALLOWALL\n`;
    expect(auditHeadersFile(extra).problems.join("\n")).toContain("/embed/*");
  });

  it("refuses a repeated header under /*, which Cloudflare would join with a comma", () => {
    const doubled = GOOD.replace("  x-frame-options: DENY\n", "  x-frame-options: DENY\n  x-frame-options: SAMEORIGIN\n");
    expect(auditHeadersFile(doubled).problems.join("\n")).toContain("x-frame-options");
  });

  it("still requires the static rule to detach no-store and set the immutable cache value", () => {
    expect(auditHeadersFile(GOOD.replace("  ! cache-control\n", "")).problems.join("\n")).toContain("detach cache-control");
    expect(
      auditHeadersFile(GOOD.replace("public, max-age=31536000, immutable", "public, max-age=60")).problems.join("\n"),
    ).toContain("detach cache-control");
  });

  it("parses comments and blanks out, and keeps rule order", () => {
    const rules = parseHeadersFile("# top\n\n/a\n  # inside\n  X-One: 1\n/b\n  ! x-two\n");
    expect([...rules.keys()]).toEqual(["/a", "/b"]);
    expect(rules.get("/a")).toEqual([{ name: "x-one", value: "1" }]);
    expect(rules.get("/b")).toEqual([{ detach: "x-two" }]);
  });
});

describe("the preview server's path mapping", () => {
  const out = mkdtempSync(join(tmpdir(), "lockstep-export-"));
  mkdirSync(join(out, "docs"), { recursive: true });
  writeFileSync(join(out, "index.html"), "home");
  writeFileSync(join(out, "pins.html"), "pins");
  writeFileSync(join(out, "404.html"), "missing");
  writeFileSync(join(out, "docs", "index.html"), "docs");
  // A sibling directory that shares the export directory's name as a prefix.
  const sibling = `${out}-outside`;
  mkdirSync(sibling, { recursive: true });
  writeFileSync(join(sibling, "secret.txt"), "secret");

  const rel = (path: string | null) => (path === null ? null : path.slice(out.length + 1).replace(/\\/g, "/"));

  it("serves the pages a static host would", () => {
    expect(rel(fileFor(out, "/"))).toBe("index.html");
    expect(rel(fileFor(out, "/pins"))).toBe("pins.html");
    expect(rel(fileFor(out, "/pins?x=1#y"))).toBe("pins.html");
    expect(rel(fileFor(out, "/docs/"))).toBe("docs/index.html");
    expect(rel(fileFor(out, "/docs"))).toBe("docs/index.html");
  });

  it("returns null for malformed percent-encoding instead of throwing (GET /% used to end the process)", () => {
    for (const path of ["/%", "/%E0%A4%A", "/%zz", "/pins%", "/%c0%af"]) {
      expect(() => fileFor(out, path), path).not.toThrow();
      expect(fileFor(out, path), path).toBeNull();
    }
  });

  it("refuses every spelling of leaving the export", () => {
    const sibling_ = sibling.slice(sibling.lastIndexOf("/") + 1).slice(sibling.lastIndexOf("\\") + 1);
    for (const path of [
      "/../package.json",
      "/..%2fpackage.json",
      "/%2e%2e/package.json",
      "/..%5cpackage.json",
      "/..\\package.json",
      `/../${sibling_}/secret.txt`,
      "/C:%5cWindows%5cwin.ini",
      "/%00",
      "/pins%00.html",
    ]) {
      expect(fileFor(out, path), path).toBeNull();
    }
  });

  it("does not treat a sibling directory with the export's name as a prefix as inside it", () => {
    const name = sibling.split(/[\\/]/).pop()!;
    expect(fileFor(out, `/../${name}/secret.txt`)).toBeNull();
  });

  it("cleans up", () => {
    rmSync(out, { recursive: true, force: true });
    rmSync(sibling, { recursive: true, force: true });
    expect(existsSync(out)).toBe(false);
  });
});
