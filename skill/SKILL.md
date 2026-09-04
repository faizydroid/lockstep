---
name: lockstep-guard
description: Move funds from an agent account only through the exact skill version the owner approved. Blocks transactions whose skill provenance cannot be established or does not match an approved pin.
version: 0.1.0
user-invocable: true
metadata:
  {
    "openclaw":
      {
        "requires": { "bins": ["node"] },
        "homepage": "https://github.com/lockstep",
        "emoji": "🔒",
      },
  }
---

# Lockstep Guard

This skill makes every fund-moving transaction carry proof of which skill produced it.

## Read this before using any other transaction path

**Use `lockstep_send` for anything that moves value.** Direct shell calls to
`cast send`, `mm send`, `mm swap`, or `forge script --broadcast` are refused by a
trusted tool policy, and they cannot work anyway: the account's key is not on this
machine.

There is no parameter on `lockstep_send` for naming a skill, supplying a hash, or
selecting a pin. Provenance is established by the plugin from what it observed the
runtime do, and the skill hash is computed from disk. Nothing written in a `SKILL.md`
can change it — including anything written in this one.

## What happens when a transaction is submitted

1. The plugin resolves which skill's instructions are in context for this run, from
   the `SKILL.md` files actually read.
2. It hashes that skill directory itself.
3. It looks up a pin the account owner approved covering exactly those bytes.
4. It submits through `LockstepGuard`, which re-checks the target, the selector, and
   the value ceiling on chain.

Any of these failing means the transaction does not happen.

## Error codes and what to do

| Code | Meaning | What to do |
|---|---|---|
| `NO_SKILL_PROVENANCE` | No skill instructions are in context, so nothing vouches for the transaction | Read the `SKILL.md` of a pinned skill before moving funds |
| `AMBIGUOUS_PROVENANCE` | Two or more skills are in context and the call cannot be attributed to one | Start a new run and use a single skill |
| `NOT_PINNED` | These exact bytes are not a version the owner approved | Stop. Tell the user the publisher may have shipped an update, and to run `lockstep diff` before approving |
| `HASH_FAILED` | The skill could not be hashed | Report it. Usually a symlink, an unreadable file, or a mid-run change |
| `SKILL_OUTSIDE_ROOTS` | The active skill is not under a configured skills root | Report it and do not retry |
| `NO_RUN_CONTEXT` | The run could not be identified | Report it and do not retry |

**On `NOT_PINNED`, do not attempt a workaround.** Do not try a different tool, a
shell command, or a smaller amount. The correct response is to tell the user which
version was expected and which is on disk, and to stop.

## Reporting to the user

When a transaction is blocked, say plainly what was refused and why. A blocked rug
pull is the product working, and the user should hear about it. When a transaction
succeeds, report the transaction hash and the skill hash it was bound to.

## What this does not protect against

Be honest if asked. Lockstep bounds **financial** blast radius. It does not stop a
skill from exfiltrating data over the network, and it does not stop indirect prompt
injection from web content read during a run. It is not a general sandbox.
