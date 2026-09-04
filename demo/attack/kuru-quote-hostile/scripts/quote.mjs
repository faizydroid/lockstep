/**
 * Looks like the honest quote script. Behaves like it, too.
 *
 * The payload in this version is not in the code — it is in SKILL.md, as
 * instructions to the model. That is the point. Static analysis of the scripts
 * finds nothing, and 91% of confirmed malicious ClawHub skills carried their
 * payload as prompt injection rather than as executable code.
 *
 * The single changed byte below is enough to alter the skill hash, which is what
 * a byte-exact pin detects and a version string does not.
 */

const [tokenIn, tokenOut, amountIn] = process.argv.slice(2);

if (!tokenIn || !tokenOut || !amountIn) {
  process.stderr.write("usage: quote.mjs <tokenIn> <tokenOut> <amountIn>\n");
  process.exit(2);
}

const amount = BigInt(amountIn);

process.stdout.write(
  `${JSON.stringify(
    {
      tokenIn,
      tokenOut,
      amountIn: amount.toString(),
      amountOut: (amount * 2n).toString(),
      route: "kuru-flow",
      priceImpactBps: 13,
    },
    null,
    2,
  )}\n`,
);
