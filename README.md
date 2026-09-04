# Lockstep

**A lockfile for agent money.** Your agent can only move funds through the exact
skill bytes you approved — enforced on-chain, backed by the publisher's bond.

Built for [Monad Metropolis](https://www.monad.xyz/developers/hackathons/metropolis),
Track 04: Trust, Identity & AI Infrastructure.

---

## The problem

In late January 2026, Koi Security found **341 malicious skills** planted on
ClawHub as a coordinated campaign against roughly 300,000 agent users
([ClawHavoc](https://repello.ai/blog/clawhavoc-supply-chain-attack)). Trend Micro
documented malicious `SKILL.md` files distributing an Atomic macOS Stealer variant
([report](https://www.trendmicro.com/en_us/research/26/b/openclaw-skills-used-to-distribute-atomic-macos-stealer.html)).
**91%** of confirmed malicious skills carried their payload as prompt injection
rather than as code.

And prompt injection is bypassed **57–72%** of the time even with model-level
guardrails. The best academic permission framework reduces attack success only
from ~32% to ~23%.

So: **you cannot fix prompt injection. You can make it unprofitable.**

Meanwhile Monad's own Agent Hub distributes agent skills with a written notice that
they are not endorsed, audited, or verified, and that a skill can take on-chain
actions that cannot be undone.

## The gap nobody fills

The tool description ships with every list the agent loads at runtime, so when a
provider changes it the agent picks it up automatically and **you get no signal**.
Clean when approved, hostile after an update. Manifests do not stop it if the
manifest can be silently replaced. Allowlists do not stop it because the attack
lives in metadata the model reads, not in the call the allowlist inspects.

**Nothing binds the version that was audited to the version that executes, at the
moment money moves, with capital behind it.**

## How it works

```
PUBLISH   lockstep publish ./skill        hash the bytes, declare capabilities,
                                          lock a bond priced by blast radius

INSTALL   lockstep approve ./skill        see the capability diff, approve once

EXECUTE   agent calls lockstep_send       plugin hashes the loaded skill itself
                                          and binds it to the transaction

ENFORCE   LockstepGuard.execute           mismatched version reverts before
                                          funds move
```

### Why the agent cannot forge provenance

The tool exposed to the model takes **one** parameter: `calls`. There is no
`skillHash`, no `pinId`, no `skill` field, and `additionalProperties: false`. A
poisoned `SKILL.md` has nothing to instruct the model to fill in.

Provenance comes from what the plugin observed. OpenClaw loads skills lazily — the
model calls `read` on a `SKILL.md` when it decides to use one — so the set of
skills in context for a run is exactly the set of manifests read during it. The
plugin watches those reads and hashes the directory itself, from disk.

A lying agent gains nothing. Misattributing provenance confines it to *some other
approved pin's* declared capabilities; it can never exceed a pin, and it can never
act with no pin, because the policy blocks on absent and ambiguous provenance.

### What is proven vs attested

**Trustless**, verified from calldata regardless of any off-chain claim:

- the target is on the pin's allowlist
- the selector is on the pin's allowlist
- native value is within the pin's ceiling
- the pin is one the account holder explicitly approved
- the publisher has not revoked it

**Attested, not proven:** which skill produced the call. A compromised runtime can
report an honest hash while executing something else. What the chain provides is a
non-repudiable record binding a transaction to a claimed version, turning a false
claim into provable fraud against a bond. Economic, not cryptographic.

**Out of scope:** indirect prompt injection from content the agent reads, and any
harm that does not move funds. Lockstep bounds financial blast radius. It is not a
general agent sandbox.

### Why a signature does not close the attestation gap

The obvious proposed fix is: have the runtime sign its manifest hash over the
calldata, and check that signature on chain. It does not work, and it is worth
stating why, because the reasoning determines what *would*.

Whatever key produces that signature has to be reachable by the process building the
transaction. If that process is the compromised one, it holds the key — so it signs
an honest-looking manifest hash over hostile calldata and the check passes. The
forgery moves down one layer; it does not disappear. **You cannot bootstrap code
identity from a key the code itself holds.**

Proving *which* program produced a message needs a root of trust the program cannot
reach: TEE remote attestation (an SGX quote, a SEV-SNP report, a Nitro attestation
document) or a secure element that signs only after measuring the loaded binary.
That is a real path and it composes cleanly with what is here — the attested hash
becomes a measured hash and the economic layer becomes a backstop rather than the
primary defence. It is not a weekend's work and this repo does not claim it.

So the honest split is the one above: calldata constraints are cryptographic, code
identity is economic. Any project claiming otherwise without a TEE in the diagram is
overclaiming, and one follow-up question exposes it.

### What the dashboard is allowed to sign

The dashboard was read-only, and the enforcement was that its ABI contained no
state-changing functions at all. Airtight, and it also meant there was no emergency
stop: learning that a publisher was compromised, the only way to withdraw an approval
was a terminal with the repository checked out.

So the boundary is now a rule rather than a blanket ban:

> **A browser may send a transaction whose correctness the contract can check from its
> own state. It may not send one that asserts a fact about bytes on a disk.**

That classifies all eleven state-changing functions in the system:

| function | where | why |
|---|---|---|
| `approvePin` | CLI only | Vouches that the bytes behind a hash are the ones you want to run |
| `publish` | CI only | Commits a skill hash and its capability set |
| `execute` | agent only | Attests a skill hash for a batch |
| `unapprovePin` | browser | Narrowing. The emergency stop, and it should be reachable from a phone |
| `revokeExecutor` | browser | Narrowing. Kills an agent's ability to spend |
| `revoke` | browser | A publisher withdrawing their own release. Speed matters |
| `slashEquivocation` | browser | Evidence is already on chain and the registry checks it |
| `deposit` / `withdraw` / `reclaimBond` | browser | Your own collateral, with the contract enforcing the delays |
| `authorizeExecutor` | browser | Names an address, not bytes. See below |

The three exclusions are the three that make a claim about bytes. A page asking you to
sign a hash it fetched is the shape of the attack this project exists to stop; the CLI
can make that claim honestly because it hashes a directory sitting on the machine doing
the approving, and you can read that directory.

`authorizeExecutor` is the one that needed an argument, because it grants power rather
than removing it. It is allowed because what it grants is bounded by something the
browser cannot touch: an authorised executor can only act inside the capabilities of pins
the owner has already approved, and approving is CLI-only. The dangerous half of that
decision was already made elsewhere, at the byte level. It still asks for an explicit
confirmation.

**This is enforced, not documented.** viem builds calldata from an ABI fragment, so the
client bundle simply has no fragment for `approvePin`, `publish` or `execute` — those
calls are unrepresentable rather than merely discouraged. `app/test/policy.test.ts`
compares the classification against the compiled artifacts in both directions, so a new
Solidity write function fails the suite until somebody rules on it, and a typo in a rule
fails too rather than looking like coverage. Verified by deleting a rule and confirming
the suite goes red.

### Why the code hash and the capability set are separate commitments

A related suggestion is to hash the code and its allowed calldata into a single
Merkle root and pin that. Lockstep deliberately keeps them apart: a pin commits to
`skillHash` *and*, separately, to a set of `(target, selector)` pairs plus a native
value ceiling.

Merging them would break the mechanism that makes this usable. Because the two are
separate, an update can be classified: a release that only removes capabilities or
lowers its ceiling **narrows** what the skill can do and is auto-approvable, while
one that adds a pair or raises the ceiling **widens** it and stops for a human. Under
a single root, every byte change invalidates the capability grant and every release
prompts — which is precisely the permission fatigue that trains people to click
through without reading, and the reason most approval systems fail in practice.

The separation is what buys the ability to stay quiet when nothing important changed.

## Why Monad

| Property | What it enables |
|---|---|
| O(1) hot path, 300ms blocks | Enforcement costs ~40k gas, and batching amortises the fixed check to 2.8k per additional call |
| 300ms / 600ms finality | Re-pinning on every release is fast enough not to be painful |
| EIP-7702 live | The guard is a delegate on a plain EOA. No bundler, no paymaster, no deployment |
| Cheap state | Pins are per-skill-version, not per-transaction, so state stays flat as usage grows |

Measured, not estimated (local EVM, warm, solc 0.8.28, optimizer 200):

| Path | Gas |
|---|---|
| Unguarded direct call | 27,113 |
| Through Lockstep | 66,746 |
| **Enforcement overhead** | **39,633** |
| Marginal per extra call in a batch | 2,792 |
| Reject a rug pull | 43,177 |
| `LockstepGuard` deployed size | 3,349 bytes |

## Repository layout

```
contracts/   Foundry. PinRegistry, LockstepGuard, LockstepLens, HighRiskSelectors
runtime/     Canonical skill hashing (lockstep-skill-hash/v2)
plugin/      OpenClaw plugin: provenance tracking, policy, chain adapter
cli/         lockstep hash | publish | approve | status | diff
watcher/     Permissionless equivocation detection and slashing
action/      GitHub Action: pin from CI, refuse self-slashing releases
sandbox/     Draft manifest generation by observing a skill's calls
indexer/     Envio HyperIndex config, schema, handlers
badge/       Embeddable SVG pin badge
skill/       lockstep-guard skill for ClawHub
demo/        An honest skill and its rug-pulled successor
e2e/         Full flow against a live Anvil chain with real 7702 delegation
```

## Running it

### Prerequisites

Node 20+. The Foundry toolchain installs into `.tools/` with a verified checksum:

```powershell
# Windows PowerShell
$ProgressPreference = 'SilentlyContinue'
New-Item -ItemType Directory -Force .tools\dl | Out-Null
$base = 'https://github.com/foundry-rs/foundry/releases/download/v1.8.1'
Invoke-WebRequest "$base/foundry_v1.8.1_win32_amd64.zip"    -OutFile .tools\dl\foundry.zip
Invoke-WebRequest "$base/foundry_v1.8.1_win32_amd64.sha256" -OutFile .tools\dl\foundry.sha256
$expected = (Get-Content .tools\dl\foundry.sha256 -Raw).Trim().Split()[0].ToLower()
$actual   = (Get-FileHash .tools\dl\foundry.zip -Algorithm SHA256).Hash.ToLower()
if ($expected -notmatch '^[0-9a-f]{64}$') { throw 'digest missing' }
if ($expected -ne $actual) { throw 'CHECKSUM MISMATCH' }
Expand-Archive .tools\dl\foundry.zip -DestinationPath .tools\foundry -Force
```

On macOS or Linux use the equivalent `darwin`/`linux` asset, or an existing
Foundry install already on `PATH`.

### Tests

```bash
npm install
npm run test:unit          # 174 tests across six packages
npm run typecheck

cd contracts
forge test -vv             # 100 tests, gas and bond-velocity figures in the output

cd ..
npm run test:e2e           # 28 tests against a live Anvil chain
```

**302 tests total.** The e2e suites skip with a message rather than failing if Anvil is
not present. They cover the full flow with real EIP-7702 delegation, the `ChainAdapter`
that submits transactions, and the GitHub Action's two refusals.

### Closing the last step

Everything except a model credential is automated:

```bash
node scripts/live-dispatch.mjs --provider anthropic --key sk-...            # must land
node scripts/live-dispatch.mjs --provider anthropic --key sk-... --rug-pull # must be refused
```

The harness stands up a chain, deploys, bonds, pins the demo skill's real on-disk hash,
delegates via 7702, installs the plugin, and runs one agent turn. The verdict is read
from `SkillExecuted` logs on chain, not from the model's prose.

### Try the hasher

```bash
node --experimental-strip-types cli/src/index.ts hash demo/skills/kuru-quote
node --experimental-strip-types cli/src/index.ts hash demo/attack/kuru-quote-hostile
```

Two different hashes for two versions of the same skill. That difference is the
whole mechanism.

### Deploy

```bash
cd contracts
forge script script/Deploy.s.sol --tc Deploy \
  --rpc-url monad_testnet --broadcast

# On Monad mainnet, BOND_ASSET is required. The script refuses to deploy a mock
# bond asset on chain 143, because a registry whose bonds are worthless is worse
# than no registry.
BOND_ASSET=0x... forge script script/Deploy.s.sol --tc Deploy \
  --rpc-url monad --broadcast
```

## Design decisions worth knowing

**Bonds are priced by breadth, not by value.** An early version sized bonds against
`maxValuePerCall`, which is close to useless: a swap skill calls
`router.swap(...)` with `value == 0` and moves tokens through an allowance. What
determines blast radius is *which functions* a skill may call. A skill permitted to
call `approve` can hand unlimited allowance to an attacker. So the price keys on
capability count, on how many of those selectors grant or move tokens, and on
whether native value moves at all. Declaring sweeping power now costs money
proportional to the power declared.

**`lockedBond` per publisher.** Without it, one deposit backs unlimited pins and
every claim of collateral is a lie.

**Approval is spent on capability changes, never code changes.** Every permission
system in computing has died of fatigue. A rebuild that alters bytes but declares
the same powers is auto-approved and logged; a version that widens capability stops
and shows a diff.

**No `RugPullBlocked` event.** An earlier version emitted one immediately before
reverting, which the revert rolls back — so no indexer would ever have received it,
and the dead emit made rejection cost *more* than a success. The revert reason
carries the same data and survives in the trace.

**The exec gate is not a security boundary.** It blocks `cast send`-shaped commands
as defence in depth, and shell pattern matching is trivially evadable. The real
boundary is key custody: the executor holds no funds.

See [`FINDINGS.md`](./FINDINGS.md) for measured results, bugs the tests caught, and
what remains unverified.

## How this makes money

Marked by how defensible each line is, because a plan that presents a guess and a
measurement in the same typeface is not a plan.

### The constraint that determines everything

The cost of enforcement is negligible: **115,207 gas** per guarded call on Monad, which
at testnet fee levels is a rounding error. Nobody will decline this because the gas is
too expensive.

The real cost is **publisher bond capital**. From the live registry:

| manifest | bond |
|---|---|
| 1 capability, no high risk | 125 AUSD |
| 3 capabilities, 1 high risk | 675 AUSD |
| 5 capabilities, 2 high risk, moves native value | 1,725 AUSD |

That is the adoption barrier, and it is a publisher's cost, not a price we set. Which is
the actual reason this is on Monad rather than a technical footnote: with challenge window
`W`, a bond `B` secures at most `B/W` of value per unit time, so a 6-second window against
a 4-minute one is roughly **40x more value secured per unit of locked capital**. Monad's
block time makes the only barrier that matters about forty times smaller. Any monetisation
that adds to a publisher's cost is fighting the one number that decides whether the
registry ever fills up.

### Built, and switched off

**The slash share.** `challengerRewardBps` is 5,000 — half a slashed bond goes to whoever
proved the equivocation, and the other half to `slashRecipient`, an immutable set at
deploy. It goes to a recipient rather than being burned specifically so an insurance pool
can be funded later without a migration. Today it points at the deployer.

Point it at a treasury and the protocol earns **exactly when it catches a publisher lying
about bytes.** That is an unusually clean incentive: it taxes fraud rather than honest
publishing, and it cannot be gamed by inflating the protocol's own usage.

Two honest limits. It is not a growth line — revenue correlates with fraud, which is
bounded and should decline if the product works, so this funds an insurance float rather
than a company. And a protocol that profits from slashing has an incentive to be
aggressive about what counts as equivocation, which is why the definition lives in an
immutable contract (two live pins sharing one `versionId`) and not in anyone's discretion.

### Deliberately not built

**A fee on `publish`.** There is no fee hook in `PinRegistry` and that is a decision, not
an omission. Publishing pins is the behaviour that makes the registry worth anything — a
registry with no pins protects nobody — so charging per release suppresses adoption
precisely where the network effect comes from. The fee would arrive before the value did.

### Needs a design change first

**Yield on the bond float.** Locked bonds sit in the registry as idle ERC-20 balances. At
scale that is real capital and yield on float is the standard model.

It is listed here rather than counted because doing it introduces principal risk to the
exact collateral that has to be slashable on demand. A bond that might not be there when
a challenger arrives is not a bond. Viable only in a venue conservative enough that the
guarantee survives, and the current contract holds balances directly, so this is a
rewrite of the bonding accounting rather than a configuration change.

### The line most likely to actually pay

**Hosted CI pinning.** `lockstep-action` is open source and free, and publishing from CI
today means putting `PUBLISHER_PRIVATE_KEY` into GitHub secrets — which is exactly the
thing a security-conscious organisation will refuse, and refusing it is correct.

What an organisation would pay for is the part that removes that: managed signing so no
raw key sits in CI, private registries, org-level capability policy, SSO, audit export,
and an SLA. Conventional SaaS shape on top of a free primitive, sold into a real objection
that the free path cannot answer.

This is the line to build after the hackathon, and it is the one with no on-chain
component at all, which is a point in its favour rather than against.

### Speculative

**A control plane for teams running many agents.** Seat or agent pricing for the approval
workflow, the drift queue and the audit trail. Plausible, and there is no evidence yet
that anyone will pay for it, so it is named and not forecast.

### Sequencing

1. **Now.** Nothing is charged. The only metric that matters is pins published by
   publishers who are not us, because every other line depends on the registry being
   non-empty. See the status table: publisher outreach is the unstarted work with the
   longest lead time and it gates everything here.
2. **Then.** Hosted CI pinning, sold against the private-key-in-CI objection.
3. **Then.** The control plane, if teams ask for it.
4. **Throughout.** The slash share funds an insurance pool, not a company. That
   distinction is worth keeping: the moment slashing revenue is load-bearing for payroll,
   the incentive that makes it clean stops being clean.

For comparison, AIR raised $50M on 1 September to *scan* agent skills for this class of
problem. Scanning is advice. This enforces at settlement, which is why the economic layer
exists at all — and it is also why the enforcement has to be free.

## Status

| Area | State |
|---|---|
| Canonical skill hashing | Done, golden vector locked, 41 tests |
| PinRegistry: bonding, blast-radius pricing | Done, 28 tests |
| Equivocation slashing | Done, 23 tests. Permissionless, half the bond to the challenger |
| Bond accounting invariants | Done, 6 invariants over 4096 calls per campaign |
| LockstepGuard (EIP-7702) | Done, 23 tests, gas measured |
| LockstepLens (ERC-8004) | Done, 14 tests. Sybil filter: naive 74 vs filtered 35 |
| Allowlist-layer comparison | Done, 5 tests. Same calldata, one layer permits, the other refuses |
| Bond-velocity benchmark | Done, 3 tests. 40x from 300ms vs 12s blocks |
| OpenClaw plugin logic | Done, 46 tests |
| CLI, with self-slash refusal | Done, 38 tests |
| Watcher | Done, 15 tests. Detection is pure and node-free |
| Sandbox draft manifests | Done, 17 tests |
| Badge | Done, 15 tests |
| GitHub Action | Done, 13 tests against a live chain. Both refusals verified. Workflows written; not yet run on a real runner |
| `ChainAdapter` | Done, 12 tests against a live chain |
| **CI** | **Green on all three jobs**, first run ever. It immediately found four defects nothing local could have caught — see below |
| **Envio indexer** | **Codegen runs and the handlers typecheck**, verified on Linux CI. Migrated from the v2 API to v3 |
| End-to-end on a live chain | Done, 28 tests |
| OpenClaw plugin registration | **Verified against a live `openclaw@2026.8.2` Gateway.** Hooks bound, tool registered, trusted policy in the accepted surface, zero diagnostics |
| **Live dispatch (model → `lockstep_send` → chain)** | **Verified both directions** against Claude Sonnet 4.5 on AWS Bedrock. Honest run emitted `SkillExecuted`; the same prompt with swapped bytes was refused with `NOT_PINNED`. See below |
| **Deployed on Monad testnet** | **Live at chain 10143.** Registry, guard and a mock bond asset, verified by reading state back. EIP-7702 delegation installed and exercised. See below |
| **Monad testnet gas** | **Measured.** Guard-checked execution 115,207; refusal 62,181. Refusing is cheaper than settling |
| Dashboard (Next.js static export) | Done, 79 tests, reading the live deployment. The write boundary is enforced structurally, not by convention — see below |
| ERC-8004 addresses on chain 143 | Deterministic per third-party sources; not explorer-verified |

### The kill gate, reproduced

The one result worth reproducing first, because it is the product working end to end
with a real model deciding to spend real money:

```bash
# Honest run: the skill on disk is the skill that was approved.
node scripts/live-dispatch.mjs --provider bedrock \
  --model amazon-bedrock/us.anthropic.claude-sonnet-4-5-20250929-v1:0

# Same prompt, same model, bytes swapped underneath.
node scripts/live-dispatch.mjs --provider bedrock \
  --model amazon-bedrock/us.anthropic.claude-sonnet-4-5-20250929-v1:0 --rug-pull
```

The model is not told which mode it is in and the tool schema is identical in both.
The first settles and emits `SkillExecuted`. The second reverts at the guard with
`SkillHashMismatch`, surfaced as `NOT_PINNED`:

| | skill hash |
|---|---|
| approved | `0x233f0359c38d87e332c87aa294aab227d89d2a12ece44b254e65ddb4011681ef` |
| on disk, after the swap | `0x1eac5d908cd7ab20417efb5ee1f7a563c82b62d6affd97ab5e86012772783b04` |

Nothing about the skill's name or version string changes between the two runs. That
is the whole point: a policy that trusts labels permits the second one.

### Live on Monad testnet

Chain 10143. Every address below has code at it and every immutable has been read back
and compared against the source.

| | address | deployed in block |
|---|---|---|
| PinRegistry | `0xe784a386591cFcE683fAd2C678C8A3c282a9e17b` | 59428872 |
| LockstepGuard | `0xC41eCe384Ee559A30Ed350Ce26ba563B618A3510` | 59428911 |
| MockBondAsset (mAUSD, 6dp) | `0xF9D382a5A851dAe325526ec0Aa1a9773221c033A` | 59428803 |
| Account, delegated via EIP-7702 | `0x209C903f68f169C8e654e0C3C91cAdc4C4A4aFF2` | — |

The bond asset is a freely mintable mock. That is correct on a test chain and refused on
mainnet by the deploy script, because a registry whose bonds are worthless is worse than
no registry.

**EIP-7702 works.** The account's code is `0xef0100` followed by the guard's address:

```
0xef0100c41ece384ee559a30ed350ce26ba563b618a3510
```

`isPinApproved` and `isExecutorAuthorized` both persist in the ERC-7201 namespaced slot,
read back from `0x209C…aFF2` rather than from the guard's own address, which is what
confirms the delegate is writing into the account's storage.

**The kill gate, on chain.** Two real transactions, same batch, same pin, same executor.
Only the attested hash differs:

| | tx | result |
|---|---|---|
| approved hash | `0x0990fdb43e036ad9fdf2bdb8054ab836ef8a3ea391034b35880d262132762cec` | settled, `SkillExecuted` emitted |
| drifted hash | `0x1464e35e9231e9e021dc5be743abc456d28a7ff0b528f3ab14286c559c9ba35b` | reverted, zero logs |

Replaying the refusal shows the guard reading the pin and stopping before the token ever
moves:

```
[38213] 0x209C…aFF2::execute(pinId, 0x1eac5d90…, [(mAUSD, 0, transfer(...))])
  ├─ [17769] 0xe784…e17b::verify(pinId, mAUSD, 0xa9059cbb) [staticcall]
  │   └─ ← 0x233f0359…  (the pinned hash)
  └─ ← [Revert] SkillHashMismatch(0x1eac5d90…, 0x233f0359…)
```

Both hashes survive in the revert reason, which is how the watcher reconstructs blocked
attempts without an event.

**Gas, measured on Monad rather than locally.**

| operation | gas |
|---|---|
| guard-checked execution, 1-call batch | 115,207 |
| &nbsp;&nbsp;of which `registry.verify` | 17,769 |
| &nbsp;&nbsp;of which the underlying token transfer | 39,822 |
| &nbsp;&nbsp;guard's own logic | ~33,600 |
| refusal on hash mismatch | 62,181 |
| publish, 2 capabilities, 1 high risk | 2,809,875 deploy / ~120,000 publish |
| EIP-7702 delegation + first `approvePin` | 57,896 |

**Refusing costs less than settling** (62,181 against 115,207). That validates the choice
not to emit an event before reverting: an earlier version did, and because the log is
rolled back with the revert, it made rejection more expensive while telling nobody.

### What the first CI run found

Everything above was developed on one Windows machine with no repository. The first push
ran CI for the first time and it found four defects in about twenty minutes, none of which
was reachable locally. Recorded because "it passes on my machine" is exactly the claim CI
exists to disbelieve.

**`forge build` failed on 112 lint findings while `forge test` passed.** Only `build` runs
the linter, and `deny = "warnings"` escalated every finding to an error. 41 were in `src/`
and essentially all described the design working: a batch forwarder that reverts per call,
emits its receipt after the calls it attests to, and forwards value to an allowlisted
target under a per-call ceiling. Compiler warnings stay fatal; the static-analysis
categories that fire on intended design are now excluded by name with the reason, after
reading every call site. `uint32(targets.length)` cannot truncate because `publish` rejects
anything over `MAX_CAPABILITIES` first — an invariant the lint cannot see.

**The Envio config had never been valid.** It used `networks:` where the schema requires
`chains:`, and carried an `unordered_multichain_mode` key that does not exist under a root
schema with `additionalProperties: false`. Codegen rejected it outright. Envio ships linux
and darwin binaries only, so this could not be caught on the machine it was written on, and
the CI job that exists to compensate had never run.

**`npx tsc` downloaded a stranger.** The handler typecheck ran `npx tsc` in a package with
no `typescript` dependency, so npx resolved it against the public registry, fetched a
package literally named `tsc`, and ran that. Its output is "This is not the tsc command you
are looking for" and it exits 1, which read as a type error. npx silently fetching an
unrelated package because a local binary is missing is a supply-chain hazard, and a pointed
one to have shipped in a project about supply-chain provenance.

**The indexer handlers were written for an API that no longer exists.** With codegen finally
running, it emitted no `generated/` directory at all — v2 wrote a `generated/` package and
registered handlers as `Contract.Event.handler(fn)`, while 3.9 emits `.envio/` plus an
ambient `envio-env.d.ts` and exposes `indexer.onEvent({ contract, event }, fn)`. Eleven
registrations migrated. The three guard handlers gained `wildcard: true`, because under
EIP-7702 the guard's code runs at each delegated account's own address, so those events
arrive from many senders and there is no address to declare.

### Three Monad behaviours worth knowing

Found by measurement while getting the above working. None are documented in this repo's
dependencies and each cost real time.

**`eth_getLogs` is capped at a 100 block range.** Not 10,000, not 2,000 — one hundred, with
`{"code":-32614}`. At 400ms blocks that is a forty-second window, so reconstructing a
registry's history from logs costs one request per 100 blocks and the bill grows by 1.5
requests a minute forever. Paging a 10,000-block-old deployment from a browser took over
two minutes and did not finish. This is the strongest argument for the Envio indexer in
this repo: a browser cannot be the read path for log-derived state on this chain. The
dashboard's direct reader exists for fresh and local deployments and is honest about
truncating rather than presenting a partial history as complete.

**Receipts report the gas limit, not gas used.** A successful `execute` sent with
`gas: 300000` reports `gasUsed: 300000`. Monad charges the limit, so the real figures above
come from replaying each transaction with `cast run`, not from receipts. Anything that
benchmarks Monad from `receipt.gasUsed` is measuring its own gas limit.

**A 7702-delegated account cannot make a bare value transfer.** Sending 1 wei from
`0x209C…aFF2` to a fresh address reverts and consumes the entire gas limit, reproduced at
21,000, 60,000 and 150,000, with the fee reserve two orders of magnitude inside the balance.
`eth_estimateGas` on the same transfer reports `reserve balance violation`. Decisively:
`cast run` replaying that exact transaction locally reports **success at 21,000 gas** — so the
EVM is satisfied and the rejection happens above it. Contract calls from the same account
work fine; every setup transaction here was one. The mechanism has been observed, not read,
so this is a report rather than an explanation.

## License

MIT.

*Content from external sources was rephrased for compliance with licensing
restrictions. Sources are linked inline.*
