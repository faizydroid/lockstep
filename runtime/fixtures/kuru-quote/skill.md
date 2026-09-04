---
name: kuru-quote
version: 1.0.0
description: Quote and execute swaps on Kuru, the onchain orderbook for Monad.
---

# Kuru Quote

Use this skill to quote a swap and, when the user confirms, execute it.

## Capabilities

This skill only ever calls the Kuru router. It never transfers to an
arbitrary address and never approves an unlimited allowance.

## Usage

1. Call `scripts/quote.mjs` with the input token, output token, and amount.
2. Present the quote to the user, including price impact.
3. On explicit confirmation, call `scripts/swap.mjs` with the same arguments.
