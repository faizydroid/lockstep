# MetaMask integration

Lockstep and MetaMask's Delegation Toolkit answer different halves of the same question,
and the halves are easy to confuse. This directory holds the skill that explains the
boundary, and the tests that prove where it falls.

## What was actually there to integrate with

The plan for this project said "wrap the `mm` CLI". There is no `mm` CLI. MetaMask's agent
surface is [`MetaMask/skills`](https://github.com/MetaMask/skills), a repository of skills
for its developer tooling, and the relevant one is
[`gator-cli`](https://github.com/MetaMask/skills/tree/main/domains/web3-tools/skills/gator-cli)
— the CLI for the Delegation Toolkit.

That turned out to be a far better fit than the CLI the plan imagined, because `gator`
does two things Lockstep also does:

- **`gator create`** upgrades an EOA to a smart account **via EIP-7702**, the same
  mechanism `LockstepGuard` uses.
- **`gator grant --scope functionCall`** caveats a delegation by `--targets`,
  `--selectors` and `--valueLte`.

Those three flags are, exactly, the three things a Lockstep pin declares. The two systems
agree completely about *what* an agent may call.

## The skill

`domains/web3-tools/skills/lockstep-provenance/skill.md`, laid out in MetaMask's own
directory structure so it can be copied into their repo unchanged, or installed directly:

```bash
# Into a consumer repo's Claude Code skills:
cp -r integrations/metamask/domains/web3-tools/skills/lockstep-provenance \
      ~/.claude/skills/lockstep-provenance

# Or via MetaMask's installer, pointing at this checkout as an extra source:
tools/install --repo <consumer> --target <path> \
  --source /path/to/lockstep/integrations/metamask \
  --include web3-tools/lockstep-provenance
```

Frontmatter follows their schema: `name`, a `description` inside the 1,536-character
budget with when-to-use cues, `maturity: experimental`, and an `openclaw` metadata block
that their installer preserves. Named `lockstep-provenance` rather than `lockstep-guard`
so it does not collide with the OpenClaw skill in `skill/`, which has a different job:
that one instructs an agent to route spending through `lockstep_send`, this one teaches an
agent operating `gator` when a delegation scope is not enough.

`maturity: experimental` is honest — MetaMask has not reviewed it.

## What the tests prove

`contracts/test/GatorComparison.t.sol`, 12 tests. Two claims, both measured rather than
argued.

**A poisoned skill update redeems cleanly inside a granted scope.** The file models the
three caveat enforcers a `functionCall` scope installs, with terms encoded the way the
toolkit encodes them: packed addresses, packed selectors, one `uint256`. A skill that has
been silently republished under the same version string produces
`swapTo(attacker, 1000)` — allowed target, allowed selector, zero value — and the
redemption succeeds. Every caveat is satisfied, because the recipient is an argument and
no `functionCall` enforcer reads arguments.

Lockstep refuses the identical calldata, and `test_theDifferenceIsAParameter` pins down
why by selector: `redeemDelegation(delegation, target, value, callData)` has nowhere to
put the identity of the code that built `callData`;
`execute(pinId, skillHash, calls)` does. The gap is in the signature, not the
enforcement, so it cannot be closed by writing a cleverer caveat.

The tests also check the other direction: all three caveats reject what they are for, and
Lockstep enforces the same three constraints, so adopting it loses nothing.

**The two cannot share an account.** An EOA carries exactly one delegation indicator —
`0xef0100 || implementation`, twenty-three bytes, room for one address. So `gator create`
and a Lockstep delegation are mutually exclusive on a given address. `Eip7702ExclusivityTest`
establishes this by measurement and finds something worse than a plain conflict:

- Delegation replaces **code**, not **storage**.
- Re-delegating an account away from the guard leaves every approval intact in the guard's
  ERC-7201 slot while nothing enforces them.
- Anything reading those approvals via `eth_getStorageAt` reports the account as
  protected. It is not.

That finding is now written into `LockstepGuard.guardStorageSlot`'s own documentation: a
storage read is not evidence of protection, and any consumer must also check that the
account's code equals `0xef0100 || address(this)`. Nothing in this repo made that mistake
— the dashboard reads logs and `isPinApproved`, which needs a live delegation — but the
slot is exposed precisely so external tools can read it, and they would have.

The composition that does work is across accounts rather than on one: a delegation names a
delegate, and that delegate can be an address whose own spending is gated. The funded
account carries one indicator; the executor is a separate address holding no funds. That
is already how Lockstep is built.

## One thing worth quoting

Gator's own skill documentation, on key handling:

> Private keys are stored in plaintext JSON. Never use accounts with significant funds.

Cited as corroboration rather than as a dig. It is alpha software and the warning is the
responsible thing to ship. It also happens to be the same problem this project's
monetisation section identifies as the thing an organisation will pay to remove — raw keys
sitting in dotfiles and CI secrets — which suggests the pain is real and not something we
invented to have a business model.
