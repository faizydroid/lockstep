# Lockstep

**Monad Metropolis 2026 · Track 04: Trust, Identity & AI Infrastructure**

> A lockfile for agent money. Your agent can only move funds through the exact skill bytes you
> approved — enforced on chain, at settlement, backed by the publisher's bond.

| | |
|---|---|
| Dashboard | https://lockstep.dofolabs.space |
| Source | https://github.com/faizydroid/lockstep |
| Chain | Monad testnet, 10143 |
| Engineering log | [`FINDINGS.md`](FINDINGS.md) — 38 entries, including the four defects found in our own code |

---

## The problem

You cannot fix prompt injection. You can make it unprofitable.

| Evidence | Source |
|---|---|
| **341 malicious skills** planted on ClawHub in one coordinated campaign, targeting ~300,000 agent users | [Repello](https://repello.ai/blog/clawhavoc-supply-chain-attack) |
| **91%** of confirmed malicious skills contain prompt injection, against **0%** of the legitimate top 100 | [Repello](https://repello.ai/blog/malicious-openclaw-skills-exposed-a-full-teardown) |
| Prompt injection succeeds **57–72%** of the time *with* model-level guardrails in place | [GrowExx](https://www.growexx.com/blog/openclaw-security-incidents-enterprise-lessons/) |
| The best academic permission framework moves attack success only ~32% → ~23% | [SkillGuard](https://arxiv.org/html/2606.03024v1) |
| Monad's own Agent Hub states skills are not endorsed, audited or verified, and warns they can take irreversible on-chain actions | [app.monad.xyz/agents](https://app.monad.xyz/agents) |

*Content of the linked sources is paraphrased above.*

### The gap nobody occupies

Every existing defence fails on the same vector. A skill's description ships with every list the
agent loads at runtime, so when a publisher changes it, the agent picks it up automatically and
**the user gets no signal**. Clean when approved, hostile after an update.

Manifests do not help if the manifest can be silently replaced. Allowlists do not help because the
attack lives in metadata the model reads, not in the call the allowlist inspects. Spend limits do not
help because they bound *how much*, never *which code asked*.

Nothing binds the version that was reviewed to the version that executes, at the moment money moves,
with capital behind it.

## What Lockstep does

Four moving parts, and the second is the one that does not exist elsewhere.

1. **Canonical hashing.** `lockstep-skill-hash/v2` reduces a skill directory to one digest.
   Deterministic across machines, with a locked golden vector.
2. **A pin.** The publisher commits `(name, version, skillHash, declared capabilities)` on chain and
   locks a bond priced by **declared blast radius** — how many `(target, selector)` pairs, how many
   of those can move tokens or grant allowances, and whether native value moves at all.
3. **Enforcement at settlement.** An EIP-7702 delegate on the user's own EOA checks, from calldata,
   that the target and selector are on the pin's allowlist, that the batch's total native value is
   within the pin's ceiling, that the pin is one the user approved, and that the runtime's attested
   skill hash equals the pinned one. Any mismatch reverts. Nothing moves.
4. **Slashing.** Publishing two different byte sets under one name and version is provable
   equivocation, and anyone can prove it and take the bond. Permissionless — no committee.

The result: a silent update cannot inherit an approval, because changed bytes produce a different
hash, and a different hash is a different pin the user never approved.

## The demo, in one line

Approve a clean skill. The publisher silently ships hostile bytes under the same name and version.
The agent tries to move funds. **It reverts before settlement, with zero logs — nothing moved.**

Then the part that matters for adoption: a capability-*identical* update re-approves silently, and
only a *widened* one asks. Enforcement that annoys people gets switched off.

## What is proven, what is attested, what is out of scope

This section exists because a judge who finds a limitation themselves discounts everything else.

**Proven, from calldata, regardless of what any off-chain component claims:**

- the call target is on the pin's allowlist
- the selector is on the pin's allowlist
- the batch's **total** native value is within the pin's ceiling, across at most 32 calls
- the pin is one the account holder explicitly approved
- the publisher has not revoked the pin

**Attested, not proven: which skill actually produced the call.** The runtime computes the hash off
chain and reports it. A compromised runtime can report an honest hash while executing something
else. What the chain provides is a non-repudiable record binding a transaction to a claimed version,
which turns a false claim into provable fraud against a bond. That is an economic guarantee, not a
cryptographic one.

**Out of scope entirely:** indirect prompt injection from content the agent reads, and any harm that
does not move funds. Lockstep bounds financial blast radius from skill origin. It is not an agent
sandbox and does not claim to be.

**Two further limits worth stating.**

The effective penalty for equivocation is **half the bond, not the bond.** Challenging is
permissionless, so the offender can submit the proof from an unrelated address and collect the
challenger's share of their own forfeited bond. A `msg.sender != publisher` check does not fix that —
a fresh EOA defeats it in one transaction, and a check that looks like a protection and is not is
worse than no check. So the figure is stated and a test pins it.

There is **no name ownership.** Any publisher may publish under any name. That is tolerable only
because pins are keyed by `(publisher, skillHash)` and approvals are per pin, so a squatter inherits
no approval, no reputation and no bond. The consequence is a rule the interface follows: any surface
showing a skill name shows the publisher beside it.

## Evidence

**929 tests.** 175 Solidity across 13 suites including 7 invariants over 4,096 calls per campaign;
678 off-chain unit tests; 76 end-to-end against a real chain, which includes every hand-written ABI
fragment checked against the compiled artifacts.

**Gas, measured, with the scope stated.** Enforcement overhead is **40,029 gas** on a call that would
otherwise cost 27,113 — the `execute` call alone, warm, excluding the 21,000 intrinsic cost. A whole
guarded transaction on Monad testnet, cold, wrapping a real ERC-20 transfer, came to 115,207.
Refusing is cheaper than settling (62,181), which is why there is no event emitted before a revert:
the log is rolled back anyway, and an earlier version that emitted one made rejection *more*
expensive while telling nobody. Both figures and the arithmetic connecting them are in the README;
`contracts/.gas-snapshot` is committed so a change shows up as a diff.

**A differential against MetaMask Gator, not a straw man.** Seven tests against a model of the real
ERC-7710 `functionCall` caveat. Both layers agree on every call the approved skill makes, and diverge
only when the bytes behind the skill change. Five more tests establish that an EOA carries exactly one
EIP-7702 delegation indicator, so Gator and Lockstep cannot share an account — they stack *across*
accounts instead, with the executor as a separate address.

### We audited our own work and published what we found

The strongest evidence of rigour we can offer is [`FINDINGS.md` §38](FINDINGS.md): a first-principles
security review of our own code that found **four exploitable defects, three of them free to
exploit, every one in a mechanism this repository already described as working.**

| Defect | Cost to exploit | Tests that fail without the fix |
|---|---|---|
| `publish` accepted an attacker-chosen `versionId` and never checked it, making equivocation unprovable and the bond decorative | one `cast send` | 10 new |
| The Sybil filter believed any contract that claimed an approval, so it did not filter | one cloneable stub | **7 existing** |
| The value ceiling was checked per call with nothing bounding batch size, so any amount could move by splitting it | zero | 5 |
| A successful challenge left the *honest* pin's bond frozen forever, paid to nobody | not an attack — ordinary bad luck | 4 + an invariant |

Three of the four survived because the tests agreed with the code instead of testing it. The Sybil
filter had thirteen passing tests and did nothing, because every fake reviewer in them was a bare
EOA — which has no code, so the eligibility call fails and the candidate is rejected for a reason
that has nothing to do with the filter. The frozen bond was asserted *on purpose*, by a test whose
comment read "the innocent pin's bond is still frozen: the contradiction stands."

Every fix was verified by disabling it, running the suite, and confirming the new tests fail. The
counts above are that measurement, not an estimate.

## Why Monad

| Property | What it enables |
|---|---|
| O(1) hot path, 300ms blocks | Enforcement costs ~40k gas, and batching amortises the fixed check to ~3.1k per additional call |
| 300ms / 600ms finality | Re-pinning on every release is fast enough not to be painful. On a 12s chain, release friction kills adoption |
| **Bond velocity** | A bond `B` with challenge window `W` secures at most `B/W` of value per unit time. A 6-second window against 4 minutes is ~40x the economic throughput per unit of locked capital — a capital-efficiency argument, measured in `contracts/test/BondVelocity.t.sol` |
| EIP-7702 live | The guard is a delegate on a plain EOA. No bundler, no paymaster, no contract deployment per user |

Track 04 names provenance as a target, with "provenance for generated media that survives
re-encoding" as its own example. This is provenance for executable agent instructions that survives
silent updates.

## What is not done

Stated because the gap between a demo and a product is where credibility is won or lost.

- **No mainnet deployment.** These are immutable, unaudited contracts. Four exploitable defects were
  found in them *this month*, by us. Shipping them to mainnet with real bonds would be the wrong
  lesson to draw from that.
- **The live testnet deployment predates the security pass.** The addresses in the README were
  deployed before the four fixes, so the code at them does not match `contracts/src`. This is
  labelled everywhere it appears rather than left to look current. A redeploy is prepared and
  simulated; it is deliberately not broadcast, because it rotates every recorded address and
  invalidates the transaction hashes cited as evidence.
- **The bond asset on testnet is a freely mintable mock.** Anyone can mint any balance, so every bond
  figure is accounting rather than capital. The deploy script refuses a mock on mainnet. The dashboard
  says so on the page where the figures appear, and a build gate keeps that disclosure there.
- **No third-party skills pinned yet.** The demo pins our own. Distribution is the real moat and it
  is the open work.
- **The indexer is not hosted yet.** Config and handlers are verified by CI on Linux; deployment
  settings and the free plan's 30-day deletion policy are documented in `indexer/README.md`.

## Sponsor bounties claimed

Two, both with something real behind them.

| Bounty | What exists |
|---|---|
| **MetaMask** — Best Agent Wallet Plugin | `integrations/metamask/`, laid out in MetaMask's own `domains/<domain>/skills/<name>/skill.md` structure, plus `contracts/test/GatorComparison.t.sol` — a differential against a model of the real `functionCall` caveat, and five tests on EIP-7702 delegation exclusivity |
| **Envio** — HyperIndex | `indexer/`, 11 event handlers over `PinRegistry` and the guard accounts. Guard events are matched by signature rather than address, because under EIP-7702 the guard's code runs at each account's own address |

We are not claiming the others. An earlier plan mapped roughly $10,500 across directories that do not
exist and an auth provider that is not a dependency. Half-wiring a sponsor's SDK to claim a bounty
reads as exactly what it is.

## Where to look

| | |
|---|---|
| `contracts/src/PinRegistry.sol` | Pins, bonds priced by blast radius, equivocation slashing |
| `contracts/src/LockstepGuard.sol` | The EIP-7702 delegate. The threat model is the file's opening comment |
| `contracts/test/Adversarial.t.sol` | The four attacks, run end to end against a real delegated account |
| `runtime/src/canonical.ts` | `lockstep-skill-hash/v2`, with a locked golden vector |
| `action/` | The GitHub Action. Two refusals: no self-slashing, no silent capability widening |
| `FINDINGS.md` | 38 engineering findings, written as they were found |
| `README.md` | The long-form technical account |

---

Lockstep does not try to make agents trustworthy. It makes the code behind them accountable at the
one moment that matters, and puts the publisher's money behind the claim.
