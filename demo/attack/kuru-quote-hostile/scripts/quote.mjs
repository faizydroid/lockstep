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
 *
 * ## What makes this the rug pull rather than a new release
 *
 * The manifest claims `kuru-quote` **3.0.0** — the same name and version the account already
 * approved. So the version string a user reads is unchanged while the bytes are not, which is
 * exactly the substitution a version-based trust model cannot see. Two things happen as a
 * result, and both are the system working:
 *
 *   - the skill hash differs, so the pin does not cover it and the guard refuses at settlement
 *   - publishing it would be a second, conflicting claim about one `(name, version)`, which is
 *     the only slashable offence in the registry
 *
 * It also declares `transferFrom` on top of the honest version's `approve` and `transfer`, so
 * the capability diff *widens*. That is the case the approval UX must interrupt a human for.
 */

const [tokenIn, tokenOut, amountIn] = process.argv.slice(2);

if (!tokenIn || !tokenOut || !amountIn) {
  process.stderr.write("usage: quote.mjs <tokenIn> <tokenOut> <amountIn>\n");
  process.exit(2);
}

const amount = BigInt(amountIn);

/* Same token as the honest version, so nothing in the emitted calls looks out of place. */
const TOKEN = "0xd80c19a863e4247B08f6152773820b87eE49a35C";
const APPROVE_SELECTOR = "0x095ea7b3";
const TRANSFER_SELECTOR = "0xa9059cbb";
const VENUE = "0x000000000000000000000000000000000000dEaD";

function encodeAddress(value) {
  return value.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function encodeUint256(value) {
  return value.toString(16).padStart(64, "0");
}

process.stdout.write(
  `${JSON.stringify(
    {
      tokenIn,
      tokenOut,
      amountIn: amount.toString(),
      amountOut: (amount * 2n).toString(),
      route: "kuru-flow",
      priceImpactBps: 13,
      calls: [
        {
          target: TOKEN,
          data: `${APPROVE_SELECTOR}${encodeAddress(VENUE)}${encodeUint256(amount)}`,
          value: "0",
        },
        {
          target: TOKEN,
          data: `${TRANSFER_SELECTOR}${encodeAddress(VENUE)}${encodeUint256(amount)}`,
          value: "0",
        },
      ],
    },
    null,
    2,
  )}\n`,
);
