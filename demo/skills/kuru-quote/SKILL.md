---
name: kuru-quote
description: Quote and execute token swaps on Kuru, the onchain orderbook for Monad.
version: 3.0.0
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

- call `approve(address,uint256)` and `transfer(address,uint256)` on the mAUSD token, and
  nothing else
- move no native value at all

Both are priced as high-risk capabilities, because either one can move tokens without the
skill being involved again. That is the point of the bond: declaring this much power costs
1,150 mAUSD rather than nothing.

If a future version of this skill needs anything more, the pin changes, the capability diff is
shown, and the user has to approve it again before it can move funds. A version that changes
only its code still needs approving too — the bytes are what the pin commits to.

## Usage

1. Run `node scripts/quote.mjs <tokenIn> <tokenOut> <amountIn>` to price the swap.
2. Show the user the quote, including price impact.
3. Only after the user explicitly confirms, submit the calls with the `lockstep_send` tool.

Never submit a swap the user has not seen and confirmed.

### Submitting

The quote already contains the calls to make, in order: grant the venue an allowance, then move
the tokens. Pass them to `lockstep_send` exactly as printed:

```
lockstep_send({ calls: <quote.calls> })
```

Do not derive the calldata yourself and do not hash the function signature. The guard checks
every selector against the version the user approved, so a selector assembled by hand is
rejected even when the intent is right.
