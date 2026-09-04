/**
 * Formatting, which in this app is closer to correctness than to presentation.
 *
 * Two of these are genuine safety properties rather than cosmetics: a bond rendered with the
 * wrong decimals understates it by a factor of a trillion, and a hash abbreviated to a prefix
 * makes two different hashes look identical on the one screen whose entire purpose is showing
 * that they differ.
 */

import { describe, expect, it } from "vitest";

import {
  commonPrefixLength,
  formatBond,
  formatBps,
  formatCount,
  formatDuration,
  formatNative,
  shortAddress,
  shortHash,
  timeAgo,
} from "@/lib/format";

describe("shortHash", () => {
  /**
   * The property the drift view depends on.
   *
   * Real hashes from the live run share a "0x" and then diverge, but plenty of hashes share
   * several leading characters. Abbreviating to a prefix alone would render two distinct hashes
   * as the same string, which is the one mistake this display must not make.
   */
  it("keeps both ends so two hashes sharing a prefix stay distinguishable", () => {
    const a = `0x233f0359${"a".repeat(56)}`;
    const b = `0x233f0359${"b".repeat(56)}`;

    expect(shortHash(a)).not.toBe(shortHash(b));
    expect(shortHash(a).endsWith("aaaa")).toBe(true);
    expect(shortHash(b).endsWith("bbbb")).toBe(true);
  });

  it("leaves short values untouched rather than adding an ellipsis to nothing", () => {
    expect(shortHash("0x1234")).toBe("0x1234");
  });

  it("abbreviates addresses more tightly than hashes, since they are shorter", () => {
    const address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
    expect(shortAddress(address).length).toBeLessThan(shortHash(address).length);
  });
});

describe("formatBond", () => {
  /**
   * The bond asset has six decimals, not eighteen.
   *
   * An earlier version of the contract multiplied an 18-decimal ceiling by a 6-decimal bond and
   * demanded about 1e19 units to pin a 10 MON ceiling. The display has the mirror-image risk:
   * formatting a bond as ether shows 1500 AUSD as 0.0000000000000015.
   */
  it("uses the asset's own decimals", () => {
    expect(formatBond(1_500_000_000n, 6)).toBe("1500");
    expect(formatBond(1_500_000_000n, 18)).not.toBe("1500");
  });

  it("trims trailing zeros without eating the value", () => {
    expect(formatBond(1_000_000n, 6)).toBe("1");
    expect(formatBond(1_100_000n, 6)).toBe("1.1");
    expect(formatBond(0n, 6)).toBe("0");
  });

  it("appends the symbol only when given one", () => {
    expect(formatBond(125_000_000n, 6)).toBe("125");
    expect(formatBond(125_000_000n, 6, "AUSD")).toBe("125 AUSD");
  });
});

describe("formatNative", () => {
  /** A zero ceiling is a meaningful statement, so it gets words rather than a bare zero. */
  it("says a skill cannot move native value at all", () => {
    expect(formatNative(0n)).toBe("no native value");
  });

  it("treats native value as eighteen decimals", () => {
    expect(formatNative(500_000_000_000_000_000n)).toBe("0.5 MON");
    expect(formatNative(2_000_000_000_000_000_000n)).toBe("2 MON");
  });
});

describe("commonPrefixLength", () => {
  it("counts the shared leading characters two hashes have", () => {
    expect(commonPrefixLength("0xabcdef", "0xabc123")).toBe(5);
    expect(commonPrefixLength("0xaaa", "0xaaa")).toBe(5);
    expect(commonPrefixLength("0x1", "0x2")).toBe(2);
  });

  it("handles values of different lengths without running off the end", () => {
    expect(commonPrefixLength("0xab", "0xabcdef")).toBe(4);
  });
});

describe("formatCount", () => {
  it("keeps small counts exact", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
  });

  it("abbreviates once exactness stops mattering", () => {
    expect(formatCount(1500)).toBe("1.5k");
    expect(formatCount(2_400_000)).toBe("2.4M");
  });
});

describe("timeAgo", () => {
  const now = 1_772_000_000_000;
  const at = (secondsAgo: number) => BigInt(now / 1000 - secondsAgo);

  it("reads relatively for recent times", () => {
    expect(timeAgo(at(10), now)).toBe("just now");
    expect(timeAgo(at(600), now)).toBe("10m ago");
    expect(timeAgo(at(7200), now)).toBe("2h ago");
    expect(timeAgo(at(172_800), now)).toBe("2d ago");
  });

  it("falls back to a date once relative time stops being useful", () => {
    expect(timeAgo(at(86_400 * 200), now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  /** Clock skew between a node and a browser must not produce "in -3 minutes". */
  it("never reports a negative age", () => {
    expect(timeAgo(at(-600), now)).toBe("just now");
  });
});

describe("registry parameters", () => {
  it("renders basis points as a percentage", () => {
    expect(formatBps(5000n)).toBe("50%");
    expect(formatBps(250n)).toBe("2.5%");
  });

  it("renders the unbonding delay in whole units where it divides evenly", () => {
    expect(formatDuration(604_800n)).toBe("7d");
    expect(formatDuration(3600n)).toBe("1h");
    expect(formatDuration(0n)).toBe("none");
  });
});
