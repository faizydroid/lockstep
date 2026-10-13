# Lockstep

**Monad Metropolis 2026 · Track 04: Trust, Identity & AI Infrastructure**

> A lockfile for agent money. Your agent can only move funds through the exact skill bytes you
> approved — enforced on chain, at settlement, backed by the publisher's bond.

| | |
|---|---|
| Dashboard | https://lockstep.dofolabs.space (also served at https://lockstep-e7m.pages.dev) |
| Source | https://github.com/faizydroid/lockstep |
| GitHub Action | `faizydroid/lockstep/action@v0.1.2` — [source at that tag](https://github.com/faizydroid/lockstep/tree/v0.1.2/action) |
| Indexer | https://indexer.dev.hyperindex.xyz/0be4884/v1/graphql — Envio HyperIndex, GraphQL over POST ([example query](#sponsor-bounties-claimed)) |
| Chain | Monad testnet, 10143 |
| Engineering log | [`FINDINGS.md`](FINDINGS.md) — 42 entries, including the defects found in our own code, twice |

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
else. What the chain provides is a non-repudiable record binding a transaction to a claimed version. It
does **not** make a false attestation slashable: the bond is forfeited for one offence only, a publisher
committing two different byte sets under one name and version. A malicious update under a new version
is not equivocation. So the bond prices dishonest *publishing* and covers nothing else. That is an
economic guarantee, limited to that one offence, and not a cryptographic one.

**Not constrained: arguments.** The guard compares target, selector and value, never calldata
arguments. A pin that allows `transfer(address,uint256)` on a token allows a transfer of any amount to
any address, so whoever can sign as the executor can move the account's whole balance of that token. A
pin bounds *which functions can be called*, not *where the money goes*.

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

**996 tests.** 187 Solidity across 14 suites including 7 invariants over 4,096 calls per campaign;
718 off-chain unit tests; 91 end-to-end against a real chain, which includes every hand-written ABI
fragment checked against the compiled artifacts. The indexer adds 3 more, which run its handlers
against the events behind the live deployment.

**Gas, measured, with the scope stated.** Enforcement overhead is **40,349 gas** on a call that would
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

The strongest evidence of rigour we can offer is [`FINDINGS.md` §38](FINDINGS.md#38-a-first-principles-security-pass-found-four-exploitable-defects): a first-principles
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

### And again, the day before the deadline

A second audit on 13 October ran four parallel reviews (contracts, agent runtime, tooling, dashboard and
CI), each required to prove a claim with a test or a measurement, then checked the headline claims by
hand ([`FINDINGS.md` §42](FINDINGS.md#42-a-second-audit-of-the-whole-system-what-it-found-what-was-fixed-and-what-was-not)).
Against the live chain and site it was read-only. It found more serious things than the first, in places
the first never looked:

- **The production deploy gate admitted a fork pull request** that named its branch `main`, which would
  have run the fork's build with the Cloudflare token in scope. Fixed; 5 of the 10 new tests fail against
  the old gate.
- **The live dashboard could not see the live deployment.** Its log window started 294,048 blocks before
  the first event, so the live pin showed no capabilities, no approval and no executions while the page
  said "live". Fixed, and the page now says when its window stops short of the head.
- **The plugin could not find an approval on Monad's public RPC**, which refuses the log query it used.
  It worked in every test because the test chain has no range cap. Fixed with a log-free lookup, proven
  behind a proxy that refuses logs exactly as Monad's does.
- **The executor key was inherited by every command the agent ran**, so a skill script could bypass the
  plugin entirely. The key is now removed from the environment after it is read. That is the cheap half
  of a fix, and the README says what is left.

The contracts held. The review found no way to exceed a pin and the deployed bytecode matches the source.
Their limits are the ones this document already states: the guard does not look at arguments, and the
bond covers equivocation and nothing else.

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
- **The live testnet deployment now matches the audited source.** It was redeployed with separated
  publisher, account and executor identities; the account was re-delegated with `--self-broadcast`
  and the carried-over storage was cleaned. A successful `SkillExecuted` receipt exists at
  `0xc372dfb6e82eaf372f347973ad76af6c0186b69870c5e893e4b3184f8a6fb5e8`, and the refusal proof is
  `0x8136418764098f33307db27cd78663f8674a86054d759b3c9e99b8c6db4889f4` with `SkillHashMismatch`
  and zero logs. The bond asset remains a freely mintable mock on testnet.
- **The bond asset on testnet is a freely mintable mock.** Anyone can mint any balance, so every bond
  figure is accounting rather than capital. The deploy script refuses a mock on mainnet. The dashboard
  says so on the page where the figures appear, and a build gate keeps that disclosure there.
- **No third-party skills pinned yet.** The demo pins our own. Distribution is the real moat and it
  is the open work.
- **The CLI's `approve`, `diff` and `status`, and the watcher, cannot run on Monad's public RPC.** They
  scan logs from the first block and that endpoint refuses ranges over 100 blocks. The testnet approvals
  were made by script. The fix is known (compute the pin id from `--publisher` and check the manifest
  with `isAllowed`, as the plugin now does) and was not safe to ship the day before the deadline.
- **The dashboard is not built for thousands of visitors.** Each page load sends about 99 requests to
  the public RPC from the visitor's browser and takes 11 to 12 seconds, and one failed request drops the
  page to sample data. The static site itself scales; the live read does not. The fix is to read once at
  build time and ship the snapshot.
- **The executor key is only as safe as the place the agent's commands run.** It is out of the
  environment, but a process of the same user can still reach it. The boundary is OpenClaw's sandbox,
  which is off by default.
- **The bond covers one offence.** Equivocation is slashable; a malicious update under a new version, and
  a false attestation by a compromised runtime, are not.
- **The indexer is hosted on a temporary plan.** Envio's free development plan deletes a deployment
  30 days after it is created, around 11 November and after winners are announced. Seven days with
  no queries starts deletion sooner. Keeping it needs a paid plan.

## Sponsor bounties claimed

Two, both with something real behind them.

| Bounty | What exists |
|---|---|
| **MetaMask** — Best Agent Wallet Plugin | `integrations/metamask/`, laid out in MetaMask's own `domains/<domain>/skills/<name>/skill.md` structure, plus `contracts/test/GatorComparison.t.sol` — a differential against a model of the real `functionCall` caveat, and five tests on EIP-7702 delegation exclusivity |
| **Envio** — HyperIndex | `indexer/`, 11 event handlers over `PinRegistry` and the guard accounts, hosted on Envio Cloud, with tests that replay the live deployment's events through the real handlers. Guard events are matched by signature rather than address, because under EIP-7702 the guard's code runs at each account's own address |

The indexer indexes from the registry's deploy block, 61714758. It accepts POST only, so opening the
URL in a browser shows `PersistedQueryNotSupported`: the endpoint answering, not failing. This
returns the live pin, `kuru-quote` 3.0.0 with a 1,150 mAUSD bond (`requiredBond` is in the token's
6-decimal units):

```bash
curl -s https://indexer.dev.hyperindex.xyz/0be4884/v1/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ Pin { id name version requiredBond live } }"}'
```

Reading the first deployment back against the chain found three wrong fields: every execution keyed
`undefined-1`, a publisher count of zero, and capability selectors stored as 32-byte topics. All three
are fixed and covered by those tests ([`FINDINGS.md` §41](FINDINGS.md#41-the-hosted-indexers-read-model-was-wrong-in-three-fields)).
The endpoint above is the redeployment with the fixes, and its data matches the chain.

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
| `FINDINGS.md` | 42 engineering findings, written as they were found |
| `README.md` | The long-form technical account |

---

Lockstep does not try to make agents trustworthy. It makes the code behind them accountable at the
one moment that matters, and puts the publisher's money behind the claim.
