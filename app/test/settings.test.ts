import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  isAllowedAddress,
  isAllowedRpcUrl,
  isOverridden,
  parse,
  rpcHost,
  serialise,
} from "../src/lib/settings";
import type { Settings } from "../src/lib/settings";

/**
 * `localStorage` has the trust level of a URL query string: any script reaching this origin can write
 * it. So `parse` is treated as a parser for hostile input, and the interesting cases are the ones
 * where a wrong answer would be worse than a crash.
 */

describe("isAllowedRpcUrl", () => {
  it("accepts https", () => {
    expect(isAllowedRpcUrl("https://testnet-rpc.monad.xyz")).toBe(true);
    expect(isAllowedRpcUrl("https://my-node.example.com/v1/abc123")).toBe(true);
  });

  it("accepts http only on loopback, where a dev node lives", () => {
    expect(isAllowedRpcUrl("http://localhost:8545")).toBe(true);
    expect(isAllowedRpcUrl("http://127.0.0.1:8545")).toBe(true);
    expect(isAllowedRpcUrl("http://public-node.example.com")).toBe(false);
  });

  it("refuses non-http schemes", () => {
    // The one that matters: a javascript: URL sitting in a persisted field is a scripting bug waiting
    // for a refactor that stops treating it as opaque.
    expect(isAllowedRpcUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedRpcUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isAllowedRpcUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedRpcUrl("ws://localhost:8545")).toBe(false);
  });

  it("refuses embedded credentials, which are how a key leaks into storage", () => {
    expect(isAllowedRpcUrl("https://user:secret@node.example.com")).toBe(false);
    expect(isAllowedRpcUrl("https://user@node.example.com")).toBe(false);
  });

  it("refuses anything unparseable", () => {
    for (const bad of ["", "not a url", "://missing-scheme", "https://"]) {
      expect(isAllowedRpcUrl(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("isAllowedAddress", () => {
  it("accepts a well-formed address in either casing", () => {
    expect(isAllowedAddress("0x209C903f68f169C8e654e0C3C91cAdc4C4A4aFF2")).toBe(true);
    expect(isAllowedAddress("0x209c903f68f169c8e654e0c3c91cadc4c4a4aff2")).toBe(true);
  });

  it("refuses the zero address, which is the usual way to look configured and not be", () => {
    expect(isAllowedAddress("0x0000000000000000000000000000000000000000")).toBe(false);
  });

  it("refuses wrong lengths and non-hex", () => {
    for (const bad of ["0x1234", "0x" + "0".repeat(41), "209C903f68f169C8e654e0C3C91cAdc4C4A4aFF2", "0xZZ" + "0".repeat(38)]) {
      expect(isAllowedAddress(bad), bad).toBe(false);
    }
  });
});

describe("parse", () => {
  it("returns defaults for absent, empty and malformed storage", () => {
    expect(parse(null)).toEqual(DEFAULT_SETTINGS);
    expect(parse("")).toEqual(DEFAULT_SETTINGS);
    expect(parse("{not json")).toEqual(DEFAULT_SETTINGS);
  });

  it("returns defaults for a JSON value that is not an object", () => {
    // A stored array or scalar must not be indexed into as though it had fields.
    for (const raw of ["[]", '"a string"', "42", "null", "true"]) {
      expect(parse(raw), raw).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("keeps valid fields and drops invalid ones independently", () => {
    // The important half is that one bad field does not discard the good ones.
    const parsed = parse(
      JSON.stringify({
        rpcUrl: "javascript:alert(1)",
        account: "0x209C903f68f169C8e654e0C3C91cAdc4C4A4aFF2",
        deployBlock: "59431400",
        motion: "reduced",
      }),
    );

    expect(parsed.rpcUrl).toBeUndefined();
    expect(parsed.account).toBe("0x209C903f68f169C8e654e0C3C91cAdc4C4A4aFF2");
    expect(parsed.deployBlock).toBe(59431400n);
    expect(parsed.motion).toBe("reduced");
  });

  it("refuses a negative or unparseable deploy block rather than clamping silently", () => {
    expect(parse(JSON.stringify({ deployBlock: "-1" })).deployBlock).toBeUndefined();
    expect(parse(JSON.stringify({ deployBlock: "1.5" })).deployBlock).toBeUndefined();
    expect(parse(JSON.stringify({ deployBlock: {} })).deployBlock).toBeUndefined();
  });

  it("falls back to system for an unknown motion value", () => {
    expect(parse(JSON.stringify({ motion: "wiggle" })).motion).toBe("system");
    expect(parse(JSON.stringify({ motion: 7 })).motion).toBe("system");
  });

  it("only accepts quickstartDismissed as a real boolean true", () => {
    // Truthy-but-not-true would let a stored "false" dismiss the quickstart.
    expect(parse(JSON.stringify({ quickstartDismissed: "false" })).quickstartDismissed).toBe(false);
    expect(parse(JSON.stringify({ quickstartDismissed: 1 })).quickstartDismissed).toBe(false);
    expect(parse(JSON.stringify({ quickstartDismissed: true })).quickstartDismissed).toBe(true);
  });

  describe("completedSteps", () => {
    it("keeps well-formed ids and drops the rest", () => {
      const parsed = parse(
        JSON.stringify({ completedSteps: ["connect-wallet", "Bad Id", 42, null, "read-a-pin"] }),
      );
      expect(parsed.completedSteps).toEqual(["connect-wallet", "read-a-pin"]);
    });

    it("never lets an arbitrary string out of storage", () => {
      // Nothing from localStorage should be able to reach the DOM as free text.
      const parsed = parse(JSON.stringify({ completedSteps: ["<img src=x onerror=alert(1)>"] }));
      expect(parsed.completedSteps).toEqual([]);
    });

    it("deduplicates", () => {
      const parsed = parse(JSON.stringify({ completedSteps: ["a", "a", "b"] }));
      expect(parsed.completedSteps).toEqual(["a", "b"]);
    });

    it("caps the count, so an unbounded write cannot fill the quota", () => {
      const many = Array.from({ length: 500 }, (_, i) => `step-${i}`);
      expect(parse(JSON.stringify({ completedSteps: many })).completedSteps).toHaveLength(32);
    });

    it("drops an id longer than the bound", () => {
      expect(parse(JSON.stringify({ completedSteps: ["a".repeat(41)] })).completedSteps).toEqual([]);
      expect(parse(JSON.stringify({ completedSteps: ["a".repeat(40)] })).completedSteps).toHaveLength(1);
    });

    it("returns an empty list when the field is not an array", () => {
      expect(parse(JSON.stringify({ completedSteps: "connect-wallet" })).completedSteps).toEqual([]);
    });
  });
});

describe("serialise", () => {
  it("round-trips through parse, including the bigint", () => {
    const settings: Settings = {
      rpcUrl: "https://testnet-rpc.monad.xyz",
      account: "0x209C903f68f169C8e654e0C3C91cAdc4C4A4aFF2",
      deployBlock: 59431400n,
      motion: "full",
      completedSteps: ["connect-wallet"],
      quickstartDismissed: true,
    };

    expect(parse(serialise(settings))).toEqual(settings);
  });

  it("omits absent fields rather than writing nulls", () => {
    const written = JSON.parse(serialise(DEFAULT_SETTINGS)) as Record<string, unknown>;
    expect("rpcUrl" in written).toBe(false);
    expect("account" in written).toBe(false);
    expect("deployBlock" in written).toBe(false);
  });

  it("does not throw on a bigint, which plain JSON.stringify would", () => {
    expect(() => serialise({ ...DEFAULT_SETTINGS, deployBlock: 1n })).not.toThrow();
  });
});

describe("disclosure", () => {
  it("reports an override for anything that changes what is read", () => {
    expect(isOverridden(DEFAULT_SETTINGS)).toBe(false);
    expect(isOverridden({ ...DEFAULT_SETTINGS, rpcUrl: "https://x.example" })).toBe(true);
    expect(isOverridden({ ...DEFAULT_SETTINGS, deployBlock: 1n })).toBe(true);
    expect(
      isOverridden({ ...DEFAULT_SETTINGS, account: "0x209C903f68f169C8e654e0C3C91cAdc4C4A4aFF2" }),
    ).toBe(true);
  });

  it("does not report an override for a presentation-only change", () => {
    // Motion and onboarding progress change nothing about what is claimed.
    expect(isOverridden({ ...DEFAULT_SETTINGS, motion: "reduced" })).toBe(false);
    expect(isOverridden({ ...DEFAULT_SETTINGS, completedSteps: ["a"] })).toBe(false);
  });

  it("discloses the host but never the path or query, which can carry a key", () => {
    expect(rpcHost({ ...DEFAULT_SETTINGS, rpcUrl: "https://node.example.com/v1/SECRETKEY" })).toBe(
      "node.example.com",
    );
    expect(rpcHost({ ...DEFAULT_SETTINGS, rpcUrl: "https://node.example.com?key=SECRET" })).toBe(
      "node.example.com",
    );
    expect(rpcHost(DEFAULT_SETTINGS)).toBeUndefined();
  });

  it("keeps a non-default port, since that distinguishes two local nodes", () => {
    expect(rpcHost({ ...DEFAULT_SETTINGS, rpcUrl: "http://localhost:8545" })).toBe("localhost:8545");
  });
});
