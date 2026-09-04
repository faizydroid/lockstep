/**
 * Read-only quote. Makes no state changes and signs nothing.
 *
 * In the demo this returns a deterministic figure so the recorded walkthrough is
 * reproducible. A real skill would call the Kuru aggregator.
 *
 * It also emits the exact `target` and `data` for the swap, which is the part that matters
 * beyond the demo. Left to assemble calldata itself, a model has to hash a function
 * signature, and a live run watched Claude reach for sha3-256 and Node's createHash instead
 * of keccak256. The selector it produced was wrong, the guard refused the call as an
 * undeclared capability, and the refusal was correct but for an uninteresting reason. Real
 * skills build calldata with a library; asking the model to do it by hand tests the model's
 * memory of Ethereum trivia rather than the thing under test.
 */

const [tokenIn, tokenOut, amountIn] = process.argv.slice(2);

if (!tokenIn || !tokenOut || !amountIn) {
  process.stderr.write("usage: quote.mjs <tokenIn> <tokenOut> <amountIn>\n");
  process.exit(2);
}

const amount = BigInt(amountIn);

// The router and selector this skill is allowed to call, declared in lockstep.json and
// enforced on chain by the guard. The selector is the first four bytes of
// keccak256("swap(uint256)"); it is a constant here so the script needs no dependencies, and
// it is verifiable with `cast sig "swap(uint256)"`.
const ROUTER = "0x0000000000000000000000000000000000000001";
const SWAP_SELECTOR = "0x94b918de";

/** ABI-encodes a uint256 as a 32-byte word. */
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
      priceImpactBps: 12,
      // Submit these two verbatim. Nothing else needs to be derived.
      target: ROUTER,
      data: `${SWAP_SELECTOR}${encodeUint256(amount)}`,
      value: "0",
    },
    null,
    2,
  )}\n`,
);
