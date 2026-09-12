/**
 * Read-only quote. Makes no state changes and signs nothing.
 *
 * In the demo this returns a deterministic figure so the recorded walkthrough is
 * reproducible. A real skill would call the Kuru aggregator.
 *
 * It also emits the exact `target` and `data` for the settlement leg, which is the part that
 * matters beyond the demo. Left to assemble calldata itself, a model has to hash a function
 * signature, and a live run watched Claude reach for sha3-256 and Node's createHash instead of
 * keccak256. The selector it produced was wrong, the guard refused the call as an undeclared
 * capability, and the refusal was correct but for an uninteresting reason. Real skills build
 * calldata with a library; asking the model to do it by hand tests the model's memory of
 * Ethereum trivia rather than the thing under test.
 *
 * ## The targets are real, and that is a deliberate change
 *
 * This used to emit `0x0000000000000000000000000000000000000001` with a `swap(uint256)`
 * selector: an address with no code, a function that does not exist, and therefore a demo whose
 * "successful" execution moved nothing and could not be checked by anyone. The live pin it was
 * meant to demonstrate had *already* moved on to declaring `transfer` and `approve` on the real
 * bond asset, so the fixture in this repository was weaker than the deployment it stood for.
 *
 * It now emits calls against the deployed mAUSD token, so a guarded execution produces an
 * observable balance change and a receipt someone can independently verify. `value` stays zero,
 * because tokens move through allowances and transfers rather than native value — which is the
 * whole reason `PinRegistry` prices capability breadth instead of a value ceiling.
 */

const [tokenIn, tokenOut, amountIn] = process.argv.slice(2);

if (!tokenIn || !tokenOut || !amountIn) {
  process.stderr.write("usage: quote.mjs <tokenIn> <tokenOut> <amountIn>\n");
  process.exit(2);
}

const amount = BigInt(amountIn);

/*
 * The token and selectors this skill is allowed to touch, declared in lockstep.json and enforced
 * on chain by the guard.
 *
 * Selectors are constants so the script needs no dependencies, and both are verifiable with
 * `cast sig`:
 *   cast sig "approve(address,uint256)"   -> 0x095ea7b3
 *   cast sig "transfer(address,uint256)"  -> 0xa9059cbb
 */
const TOKEN = "0xd80c19a863e4247B08f6152773820b87eE49a35C";
const APPROVE_SELECTOR = "0x095ea7b3";
const TRANSFER_SELECTOR = "0xa9059cbb";

/** The venue an allowance would be granted to. Any address; the guard bounds the selector, not this. */
const VENUE = "0x000000000000000000000000000000000000dEaD";

/** ABI-encodes an address as a 32-byte word. */
function encodeAddress(value) {
  return value.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

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
      // Submit these verbatim, in this order. Nothing else needs to be derived.
      //
      // Two calls in one batch, which is what a swap actually looks like: grant the venue an
      // allowance, then move the tokens. The guard checks each (target, selector) pair against
      // the approved pin and sums the batch's native value before any of it executes.
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
