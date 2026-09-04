// Read-only quote against the Kuru aggregator. Makes no state changes.
export async function quote({ tokenIn, tokenOut, amountIn }) {
  if (!tokenIn || !tokenOut || !amountIn) {
    throw new Error("tokenIn, tokenOut and amountIn are required");
  }
  return { tokenIn, tokenOut, amountIn, route: "kuru-flow" };
}
