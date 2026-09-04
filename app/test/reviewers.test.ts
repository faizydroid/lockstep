import { describe, expect, it } from "vitest";

import { formatScore } from "../src/components/reviewers";

/**
 * `summaryValue` is an `int128` with its own decimals scale, which is why it cannot go through
 * `lib/bond.ts`. Two things had to be right and neither is obvious from the type: the sign, and
 * the fact that the scale comes from the registry rather than from a token.
 *
 * A reputation figure that silently drops its sign turns criticism into praise, so that is the
 * case these tests are mostly about.
 */
describe("formatScore", () => {
  it("keeps the sign, which is the entire meaning of a reputation value", () => {
    expect(formatScore(-450n, 2)).toBe("-4.5");
    expect(formatScore(450n, 2)).toBe("4.5");
  });

  it("does not confuse a negative value with a small one", () => {
    // The failure mode worth naming: an unsigned formatter would render both as 4.5.
    expect(formatScore(-450n, 2)).not.toBe(formatScore(450n, 2));
  });

  it("scales by the decimals the registry reports, not by a token's", () => {
    expect(formatScore(12345n, 0)).toBe("12345");
    expect(formatScore(12345n, 2)).toBe("123.45");
    expect(formatScore(12345n, 4)).toBe("1.2345");
  });

  it("renders zero as zero rather than as an empty string", () => {
    expect(formatScore(0n, 2)).toBe("0");
    expect(formatScore(0n, 0)).toBe("0");
  });

  it("pads a fraction narrower than the scale", () => {
    // 5 at two decimals is 0.05, not 0.5. Getting this wrong overstates by ten.
    expect(formatScore(5n, 2)).toBe("0.05");
    expect(formatScore(50n, 2)).toBe("0.5");
  });

  it("trims trailing zeros without eating the whole fraction", () => {
    expect(formatScore(1500n, 3)).toBe("1.5");
    expect(formatScore(1000n, 3)).toBe("1");
    expect(formatScore(1n, 3)).toBe("0.001");
  });

  it("treats a nonsensical negative scale as no scale rather than throwing", () => {
    // 10n ** BigInt(-1) throws in JS, so this has to be handled before the exponent.
    expect(formatScore(42n, -1)).toBe("42");
  });

  it("survives values near the int128 bounds", () => {
    const max = 2n ** 127n - 1n;
    expect(formatScore(max, 0)).toBe(max.toString());
    expect(formatScore(-max, 0)).toBe(`-${max.toString()}`);
  });
});
