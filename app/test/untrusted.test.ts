import { describe, expect, it } from "vitest";

import { isSafeHref, pinIdFromQuery } from "../src/lib/untrusted";

/**
 * The URL is untrusted input, the same as `localStorage`: both are fully controlled by whoever hands a
 * reader a link. React escapes text, so a string in a text node is not a scripting bug — but a URL in
 * an `href` is not escaped, and that is the gap these two functions close.
 */

describe("pinIdFromQuery", () => {
  it("accepts a 32-byte hex id in either casing", () => {
    const id = "0x6520d020348ee7a8a91fcc071d0f62cf83762c47be749e6654c7ca31c0472df4";
    expect(pinIdFromQuery(`?pin=${id}`)).toBe(id);
    expect(pinIdFromQuery(`?pin=${id.toUpperCase().replace("0X", "0x")}`)).toBeDefined();
  });

  it("returns undefined when absent", () => {
    expect(pinIdFromQuery("")).toBeUndefined();
    expect(pinIdFromQuery("?other=1")).toBeUndefined();
  });

  it("refuses anything that is not a 32-byte hex id", () => {
    for (const bad of [
      "?pin=",
      "?pin=0x1234",
      "?pin=" + "0x" + "0".repeat(65),
      "?pin=" + "0x" + "z".repeat(64),
      "?pin=<img src=x onerror=alert(1)>",
      "?pin=../../etc/passwd",
    ]) {
      expect(pinIdFromQuery(bad), bad).toBeUndefined();
    }
  });

  it("does not choke on a malformed query string", () => {
    expect(() => pinIdFromQuery("?%")).not.toThrow();
    expect(pinIdFromQuery("?%")).toBeUndefined();
  });

  it("takes the first pin param when one is repeated", () => {
    // Parameter pollution: two values, and a reader should get a defined answer either way.
    const id = `0x${"a".repeat(64)}`;
    expect(pinIdFromQuery(`?pin=${id}&pin=0xdeadbeef`)).toBe(id);
  });
});

describe("isSafeHref", () => {
  it("allows the three shapes this app actually uses", () => {
    expect(isSafeHref("/pins")).toBe(true);
    expect(isSafeHref("#settings")).toBe(true);
    expect(isSafeHref("https://docs.monad.xyz/guides/erc-8004")).toBe(true);
  });

  it("refuses the two schemes that execute", () => {
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("refuses javascript: however it is disguised", () => {
    // Browsers strip control characters before parsing the scheme, so java\nscript: runs. Refusing
    // anything containing them is more reliable than reimplementing each browser's normalisation.
    for (const bad of [
      "JaVaScRiPt:alert(1)",
      "java\nscript:alert(1)",
      "java\tscript:alert(1)",
      "java\u0000script:alert(1)",
      "  javascript:alert(1)  ",
    ]) {
      expect(isSafeHref(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("refuses a scheme-relative URL, which reads like a path and is not one", () => {
    // The subtle one. //evil.example looks relative and is an absolute URL to another origin.
    expect(isSafeHref("//evil.example/steal")).toBe(false);
    expect(isSafeHref("/evil")).toBe(true);
  });

  it("refuses plain http, since a downgrade in a security tool's own UI is not on offer", () => {
    expect(isSafeHref("http://example.com")).toBe(false);
  });

  it("refuses other schemes outright rather than allowing by default", () => {
    for (const bad of ["file:///etc/passwd", "vbscript:msgbox(1)", "blob:https://x/y", "mailto:a@b.c"]) {
      expect(isSafeHref(bad), bad).toBe(false);
    }
  });

  it("refuses empty and whitespace-only", () => {
    expect(isSafeHref("")).toBe(false);
    expect(isSafeHref("   ")).toBe(false);
  });

  it("fails closed on anything unparseable", () => {
    // The property that matters more than any individual case: unknown input is refused, not allowed.
    for (const weird of ["://", "https://", "not a url at all", "\\\\server\\share"]) {
      expect(isSafeHref(weird), JSON.stringify(weird)).toBe(false);
    }
  });
});
