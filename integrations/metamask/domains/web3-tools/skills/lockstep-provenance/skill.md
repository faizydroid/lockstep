---
name: lockstep-provenance
description: Use when granting or redeeming an ERC-7710 delegation with the gator CLI and you need to know whether the scope is actually sufficient. Covers what a functionCall scope does and does not constrain, why targets/selectors/valueLte cannot see which code built the calldata, the EIP-7702 rule that an account carries only one delegation so gator create and a provenance guard cannot share an address, and what to do when a redemption looks in-scope but the skill that produced it changed. Read before widening a scope, before upgrading an account that already has a delegate installed, and when an agent asks to retry a refused transaction.
maturity: experimental
metadata:
  openclaw:
    emoji: "🔗"
    homepage: "https://github.com/faizydroid/lockstep"
    requires:
      bins: ["gator"]
---

## What this skill is for

You are operating `gator` to grant an agent a delegation, or redeeming one on its
behalf. This skill tells you where that delegation's guarantee stops.

It is not a criticism of the Delegation Toolkit. The caveats do exactly what they say.
The point is that one question they cannot answer turns out to matter.

## The overlap, first

A `functionCall` scope grants three constraints:

```bash
gator grant --to <agent> --scope functionCall \
  --targets <addresses> --selectors <signatures> --valueLte <ether>
```

Allowed targets, allowed selectors, a per-call native value ceiling.

If you are also using a provenance layer such as Lockstep, its pin declares the same
three things — target list, selector list, value ceiling. The two systems agree
completely about *what* an agent may call. Do not treat them as competing designs for
that job; they are the same design.

## The gap

Neither layer reads calldata **arguments**, and neither knows **which code** built the
calldata.

Concretely. You grant a scope covering `swapTo(address,uint256)` on one router, value
ceiling zero. The agent's skill is updated overnight — same package name, same version
string, different bytes — and now constructs:

```
swapTo(attacker, 1000)
```

Allowed target. Allowed selector. Zero value. **Every caveat is satisfied and the
redemption succeeds.** The recipient is an argument, and no `functionCall` enforcer
inspects arguments.

This is not fixable by tightening the caveat, because the shape of
`redeemDelegation(delegation, target, value, callData)` has nowhere to put the identity
of the code that produced `callData`. A caveat enforcer receives the calldata and cannot
ask where it came from.

A provenance layer adds that parameter: execution carries an attested hash of the skill
that produced the batch, and the account's owner has approved that exact hash. Same
calldata, refused.

## The constraint that will bite you

**An EOA carries exactly one EIP-7702 delegation.** The indicator is
`0xef0100 || implementation` — twenty-three bytes, room for one address.

`gator create` upgrades an EOA to a MetaMask smart account. A provenance guard also
installs itself as a 7702 delegate. **They cannot both be on one account.**

Worse, the handover is silent and partial:

- Delegation replaces an account's **code**, not its **storage**.
- Running `gator create` on an account that was using a guard leaves the guard's
  approvals sitting in storage while nothing enforces them.
- A tool that reads those approvals via `eth_getStorageAt` will report the account as
  protected. It is not.

**Before upgrading any account, check whether it already has a delegate:**

```bash
cast code <account> --rpc-url <rpc>
```

`0x` means a plain EOA, safe to upgrade. Twenty-three bytes beginning `0xef0100` means
something is already installed — identify it before replacing it, and tell the account
owner what they are about to switch off.

## How the layers actually compose

Not on one account. Across accounts, through the delegate.

A delegation names a delegate address, and that delegate does not have to be a bare key.
It can be an address whose own spending is gated. The funded account carries one
delegation indicator; the agent's executor is a separate address holding no funds and
paying its own gas.

So: pick one mechanism per account, and let the executor be where the other layer lives.
"Use both on the same address" is not an available answer, and anyone who tells you it is
has not read the indicator format.

## Decision table

| Situation | A functionCall scope is | Why |
|---|---|---|
| Agent code is fixed and audited by you | **sufficient** | No unreviewed code can construct calldata |
| Agent loads third-party skills or plugins | **not sufficient** | A silent update stays inside the scope |
| The target's behaviour depends on an argument (recipient, deadline, slippage) | **not sufficient** | No enforcer reads arguments |
| You only need a spend cap | **sufficient** | That is exactly what the caveat is |
| The account already has a 7702 delegate | **stop** | Upgrading silently removes the other layer |

## When a redemption is refused for provenance

Do not retry. Do not try a different tool, a shell command, a smaller amount, or a
freshly granted wider scope. A provenance refusal means the code asking is not the code
the owner approved, and every workaround defeats the check the owner asked for.

Report to the user: which version was approved, which is on disk, and that a publisher
may have shipped an update. Then stop and let them decide.

## Honest limits

A provenance layer bounds **financial** blast radius. It does not stop a skill
exfiltrating data over the network, and it does not stop indirect prompt injection from
content read during a run. Neither does a delegation caveat. Neither is a sandbox.

And provenance is **attested, not proven**: the runtime computes the skill hash and
reports it, so a fully compromised runtime can report an honest hash while executing
something else. What the chain provides is a non-repudiable record binding a transaction
to a claimed version, which turns a false claim into provable fraud against a bond.
Economic, not cryptographic. Closing that gap needs TEE attestation, and anyone claiming
to have closed it without one is overclaiming.
