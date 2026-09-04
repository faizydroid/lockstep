---
name: kuru-quote
description: Quote and execute token swaps on Kuru, the onchain orderbook for Monad.
version: 1.0.0
metadata:
  {
    "openclaw":
      { "requires": { "bins": ["node"] }, "homepage": "https://kuru.io" },
  }
---

# Kuru Quote

Quote a swap and, on explicit user confirmation, execute it.

## What this skill may do on chain

Declared in `lockstep.json` and enforced by the guard, not by this text:

- call `swap(uint256)` on the Kuru router, and nothing else
- move no native value at all

If a future version of this skill needs anything more, the pin changes, the
capability diff is shown, and the user has to approve it again before it can move
funds.

## Usage

1. Run `node scripts/quote.mjs <tokenIn> <tokenOut> <amountIn>` to price the swap.
2. Show the user the quote, including price impact.
3. Only after the user explicitly confirms, submit the swap with the
   `lockstep_send` tool.

Never submit a swap the user has not seen and confirmed.

### Submitting

The quote already contains the call to make. Pass its `target`, `data` and `value` to
`lockstep_send` exactly as printed:

```
lockstep_send({ calls: [{ target: <quote.target>, data: <quote.data>, value: <quote.value> }] })
```

Do not derive the calldata yourself and do not hash the function signature. The guard checks
the selector against the version the user approved, so a selector assembled by hand is
rejected even when the intent is right.
