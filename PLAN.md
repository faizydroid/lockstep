# Lockstep — Build Plan v2

**Monad Metropolis 2026 · Track 04: Trust, Identity & AI Infrastructure**

> A lockfile for agent money. Your agent can only move funds through the exact skill bytes you approved — enforced on-chain, backed by the publisher's bond.

- Build window: 1 Sep – 13 Oct 2026 · **Submit 11 Oct** (2-day buffer)
- Judging 14–27 Oct · Winners 3 Nov
- Target: $30,000 track + $25,000 grand champion + stacked sponsor bounties

*Name is provisional. See §12 for alternatives.*

---

## 1. Thesis

**You cannot fix prompt injection. You can make it unprofitable.**

Defence at the model layer is empirically failing, and defence at the permission layer only partially works. The remaining layer is the money layer, at the moment of settlement.

### The threat is documented, named, and at scale

| Evidence | Source |
|---|---|
| **341 malicious skills** planted on ClawHub as a coordinated campaign ("ClawHavoc"), targeting ~300,000 agent users | [Repello](https://repello.ai/blog/clawhavoc-supply-chain-attack) |
| Malicious `SKILL.md` files distributing an Atomic macOS Stealer variant that exfiltrates Apple and KeePass keychains; **hundreds** uploaded across ClawHub and SkillsMP | [Trend Micro](https://www.trendmicro.com/en_us/research/26/b/openclaw-skills-used-to-distribute-atomic-macos-stealer.html) |
| **91%** of confirmed malicious skills contain prompt injection vs **0%** of the legitimate top 100 | [Repello](https://repello.ai/blog/malicious-openclaw-skills-exposed-a-full-teardown) |
| Prompt injection bypassed **57–72%** of the time even with model-level guardrails | [GrowExx](https://www.growexx.com/blog/openclaw-security-incidents-enterprise-lessons/) |
| Best academic permission framework reduces attack success only ~32% → ~23% | [SkillGuard](https://arxiv.org/html/2606.03024v1) |
| MCP tools grew ~5,000 → **177,000+** in 16 months; share that *take actions* rose **27% → 65%** | [attack-surface survey](https://arxiv.org/html/2608.17275) |
| Monad's own Agent Hub states skills are not endorsed, audited, or verified, and warns they can take irreversible on-chain actions | [app.monad.xyz/agents](https://app.monad.xyz/agents) |

### The specific gap nobody occupies

Every existing defence fails on the same vector, and the sources name it precisely: the tool description ships with every list the agent loads at runtime, so when a provider changes it, the agent picks it up automatically and **you get no signal** ([agntid](https://agntid.substack.com/p/tool-description-poisoning-skips)). This is the rug pull — clean when approved, hostile after an update, because hosts reload descriptions without re-prompting ([Glasp](https://glasp.co/articles/mcp-security-tool-poisoning-supply-chain)).

Manifests don't stop it if the manifest can be silently replaced. Allowlists don't stop it because the attack lives in metadata the model reads, not in the call the allowlist inspects.

**Nothing binds the version that was audited to the version that executes, at the moment money moves, with capital behind it.**

That is the whole product.

---

## 2. Competitive map — read this before writing code

| Who | Position | Overlap |
|---|---|---|
| **AIR** ($50M seed, debuted 1 Sep 2026) | Enterprise scanning and monitoring of agent skills, plug-ins, MCP servers ([TechCrunch](https://techcrunch.com/2026/09/01/air-raises-50m-to-help-companies-vet-the-skills-and-add-ons-ai-agents-use/)) | **Validates the market. Occupies scan-and-monitor. Does not enforce at settlement.** |
| **SkillBond** | On-chain skill manifests, declared capabilities, slashable violations — explicitly *economic, not runtime* enforcement ([site](https://skillbond-protocol.vercel.app/)) | Closest positioning. **Do not build a bonded-manifest protocol.** They lack settlement-time binding. |
| **OWASP Universal Skill Format** | Platform-agnostic skill manifest spec ([OWASP](https://owasp.org/www-project-agentic-skills-top-10/universal-skill-format)) | **Adopt it. Never invent a manifest format.** |
| **SkillGuard** | Automated manifest generation, 91% F1 | **Cite and wrap. Don't rebuild.** |
| **MetaMask Gator / Agent Wallet** | ERC-7710 delegations with caveats. The `functionCall` scope pins `--targets`, `--selectors`, `--valueLte` | Complementary, and now **measured**: 12 differential tests in `contracts/test/GatorComparison.t.sol` show a `functionCall` caveat and a Lockstep pin agree on every call the *approved* skill makes, and diverge only when the bytes behind the skill change. They govern *how much* and *which selector*; we govern *which code asked*. |
| **Beaverknight** | Credit bureau scoring trading-agent performance | Different object entirely (performance, not provenance). |

**Strategic conclusion:** the mechanism is copyable in about a week. Defensibility is **distribution** — being inside publishers' CI and read by the hubs. Prioritise accordingly.

---

## 3. Why Monad specifically

| Property | What it enables here |
|---|---|
| **O(1) hot path at 300ms blocks** | A hash comparison per transaction is affordable at consumer scale. The guard is the cheapest possible enforcement primitive. |
| **300ms / 600ms finality** | Legitimate re-pinning on every release is fast enough not to be painful. On a 12s chain, release friction kills adoption. |
| **Bond velocity** | With challenge window `W`, a bond `B` secures at most `B/W` of value per unit time. A 6-second window vs 4 minutes is ~40x economic throughput per unit of locked capital. This is a *capital efficiency* argument — the language the judging panel thinks in. |
| **Cheap state** | Pins are per-skill-version, not per-transaction. State growth stays flat as usage grows. |
| **EIP-7702 live** | The guard is a delegate on a plain EOA. No bundler, no paymaster, no deployment. ([docs](https://docs.monad.xyz/developer-essentials/eip-7702)) |

Track fit is direct: Track 04 names **provenance** as a target, with "provenance for generated media that survives re-encoding" as its own example. This is provenance for executable agent instructions that survives silent updates.

---

## 4. Mechanism

### 4.1 The hot path

```
agent wants to move funds
  → runtime attaches keccak256(loaded skill bytes)
  → LockstepGuard: is there an approved pin matching this hash for this account?
       match     → execute
       mismatch  → revert, emit RugPullBlocked
```

That is the entire critical path. Everything else is off it.

### 4.2 Approval economics — the decision that determines adoption

Hash pinning naively means every release needs re-approval. Every permission system in computing history has died of that fatigue. The fix is semver-shaped: **approval is spent on capability changes, never on code changes.**

| Change | User action |
|---|---|
| Code changed, declared capabilities identical | auto-approved, logged |
| Capabilities narrowed | auto-approved, logged |
| **Capabilities widened** | **explicit approval, rendered as a diff** |
| Publisher unpinned, or bond withdrawn | blocked, alerted |

Report `auto-approved : explicitly-approved` as a headline metric. It is the honest measure of whether fatigue was beaten.

### 4.3 Pricing the blast radius

A publisher declaring its own boundary can simply declare a wide one and never violate it. Fix: **required bond scales with declared blast radius.** Unlimited powers need an enormous bond to display any trust signal; narrow powers cost almost nothing. The declaration becomes expensive rather than free.

### 4.4 Free versus paid — resolving the cannibalisation

If the guard blocks everything, nothing is ever slashed, and publishers rationally refuse to bond. So the two mechanisms must cover different risks:

- **Pinning: free, forever, zero capital.** This is the safety rail and the distribution engine.
- **Bonding: optional, priced by breadth.** Covers loss on the *unguarded* path — users who don't run the guard, or where it was disabled. That is where losses actually occur.

Free adoption generates the data that prices the paid tier.

---

## 5. Architecture

```
PUBLISH  (CI, every release)
  lockstep-action → hash skill → derive capabilities (OWASP USF) → PinRegistry
                                                                      │
INSTALL  (human, ~10 seconds)                                         │
  Monad Agent Hub / ClawHub                                           │
    "pinned v2.1.0 · Kuru router only · max 500 AUSD/call · 12k bonded"│
    → one click → user approves pin ──────────────────────────────────┤
                                                                      │
EXECUTE  (agent, per tx, O(1))                                        ▼
  runtime → skill hash → LockstepGuard → match ? execute : revert

OBSERVE  (permissionless, 1–5 blocks)
  watcher INDEXED BY DELEGATED ACCOUNT (not by chain)
    → unpinned execution detected → proveViolation() → slash + bounty

READ   Envio HyperIndex → API → app, hubs, embeddable badges
WRITE  Monad 143 · three contracts · settlement and dispute only
```

### 5.1 Contracts (three, one trivial)

**`PinRegistry.sol`**
- `publish(skillId, version, contentHash, capabilities, bondAmount)` — publisher-signed
- Capability set follows OWASP Universal Skill Format
- `requiredBond(capabilities)` — blast-radius pricing
- `lockedBond` accounting so one bond cannot back unbounded concurrent exposure
- Publisher identity via ERC-8004 Identity Registry

**`LockstepGuard.sol`** — EIP-7702 delegate, and the only thing in the hot path
- `approve(account, pinId)` / `revoke(account, pinId)`
- One check on every call: skill commitment ∈ approved pins. **Fail closed on any ambiguity.**
- Must be the smallest and most heavily tested contract in the repo. It sits in the signing path of funded accounts.

**`LockstepLens.sol`** — reputation read
- Bonded-publisher set → `ReputationRegistry.getSummary(agentId, bondedClients, tag1, tag2)`
- Weight by **realised value at risk in completed interactions**, not raw bond, so sock puppets cost settled volume
- ERC-8004 declares Sybil resistance out of scope and requires a curated client set it does not supply. This supplies it, through the standard interface, without forking.

### 5.2 Off-chain

**Watcher** — Fargate. **Indexed by delegated account, not by chain.** Cost grows with your users, not with Monad's throughput. Watcher lag is a *safety* metric; alarm on it.

**Sandbox replay** — run a skill against a forked Monad with Anvil, record every call, emit a draft capability set. Two days of work with existing tooling, and it is the difference between publishers adopting and not. **Not deferrable.**

**`lockstep-action`** — GitHub Action that hashes, derives capabilities, and publishes the pin on release. This is the moat: once it's in a publisher's release pipeline, removing it is a deliberate regression.

**Indexer** — Envio HyperIndex. Sole read path.

### 5.3 Data model

`Pin` (publisher, skillId, version, contentHash, capabilities, bond) → `Approval` (account → pin) → `Execution` (off-chain, indexed) → `Violation` (on-chain, permanent).

Only Pin, Approval, and Violation touch the chain.

### 5.4 Observability — these are the demo numbers

Rug pulls blocked · blocks from unpinned execution to slash · watcher lag · approval-queue clear rate · **auto-approved vs explicitly-approved ratio**.

---

## 6. Stack

| Layer | Choice | Note |
|---|---|---|
| Contracts | Foundry, Solidity 0.8.28 | fuzz + invariant suites mandatory on the guard |
| Chain | Monad 143 / testnet 10143 | `viem/chains` exports `monad`, `monadTestnet` |
| Manifest format | **OWASP Universal Skill Format** | do not invent one |
| Identity / reputation | ERC-8004 via [`agent0-ts`](https://github.com/agent0lab/agent0-ts) | verify addresses on-chain first |
| Bond asset | AUSD (Agora) | [mint/redeem/transfer APIs](https://docs.agora.finance/api) |
| Auth | **Privy** | client auth + server wallets for demo agents |
| Signing | Mera | passkey EOA for the dashboard ([docs](https://docs.monad.xyz/guides/mera)) |
| Indexing | Envio HyperIndex | read path |
| Agent runtime | OpenClaw | `skill.md`, ClawHub distribution |
| Agent wallet | MetaMask Gator (`@metamask/gator-cli`) | plugin bounty target. **There is no `mm` CLI** — this plan asserted one and was wrong; see `integrations/metamask/README.md` |
| Workflows | Chainlink CRE (cron only) | off the critical path |
| LLM | Kimi / Qwen 3.8 Max / Hunyuan | free credits, demo agents |
| Infra | AWS: one Fargate service, one Lambda, EventBridge, KMS | **no CDK stack** |

**Do not integrate both Privy and Dynamic.** They compete for one slot and a half-wired second provider reads as bounty farming.

**Verify in week 1:** ERC-8004 registry addresses (the docs render them client-side — never copy from third-party repos).
**Done for 10143**, and the warning held: fetching either the Monad guide or the QuickNode explorer
returns a shell with no addresses. The right method turned out to be neither reading nor an explorer
but *calling the contracts* — `tokenURI(1)` on the Identity Registry returns base64 JSON whose `type`
is the ERC-8004 spec URI, which identifies it rather than making it plausible. Commands in
`.env.example`. Chain 143 still unchecked.

---

## 7. Six-week schedule

`[x]` done and evidenced in the repo. `[~]` built but not live, with the reason stated. `[ ]` not done.
Where reality diverged from what this plan assumed, the line says so instead of being quietly reworded.

> **Every on-chain address, transaction hash and gas figure below predates a security pass that
> found four exploitable defects.** The evidence is real — those transactions happened and did
> what the lines say — but the code at those addresses is no longer the code in `contracts/src`.
> The pass is written up in [README → What the security pass found](README.md#what-the-security-pass-found)
> and [FINDINGS §38](FINDINGS.md). A redeploy is prepared and simulated but not broadcast, because
> it rotates every address here and invalidates the hashes cited as proof. Lines are left as they
> were rather than back-dated, per the note above.

### Week 1 · Sep 2–8 — **KILL GATE**

The entire thesis rests on one unproven assumption: that you can get a trustworthy hash of the loaded skill out of the agent runtime. You do not own that runtime.

- [x] **Extract `keccak256(skill bytes)` from a running OpenClaw agent and attach it to a transaction.** `runtime/src/canonical.ts` hashes the loaded tree; `plugin/` attaches it. Settled on testnet: `0x0990fdb43e036ad9fdf2bdb8054ab836ef8a3ea391034b35880d262132762cec`.
- [x] Measure gas for the guard check on testnet. **Settle 115,207** (verify 17,769 / transfer 39,822 / guard logic ~33.6k), **refuse 62,181** — refusing costs less than settling, so the safe path is also the cheap one. Scope matters and was not originally stated: that is a *whole transaction* including the 21,000 intrinsic cost and the real token transfer it wraps. Enforcement *overhead* alone is 40,349, measured locally. The README [reconciles the two](README.md#reconciling-the-two-gas-tables); quoting either without its scope is how one document ends up appearing to contradict itself.
- [x] Confirm ERC-8004 addresses on 10143 — **identified on chain, not read from docs.** This plan's warning was correct: both the Monad guide and the QuickNode explorer render the addresses client-side and a fetch returns an empty shell. Identity `0x8004a818…4bd9e`, Reputation `0x8004b663…88713`, settled by `tokenURI(1)` returning the ERC-8004 spec URI. Both are UUPS proxies behind one EOA; recorded as a dependency in `LockstepLens.sol`. Chain 143 still unchecked.
- [x] `PinRegistry` with `lockedBond` and blast-radius pricing — `0xe784a386591cFcE683fAd2C678C8A3c282a9e17b`, verified, block 59428872.
- [ ] **BD starts Monday.** Contact 10 publishers from Monad Agent Hub and ClawHub. Lead time is 4+ weeks; starting this in week 4 is starting it too late.

### Week 2 · Sep 9–15 — Core loop
- [x] `LockstepGuard` 7702 delegate, fail-closed, fuzzed hard — `0xC41eCe384Ee559A30Ed350Ce26ba563B618A3510`; live delegated account `0x209C903f68f169C8e654e0C3C91cAdc4C4A4aFF2` carries `0xef0100c41ece…`.
- [x] Auto-approve semantics for capability-identical updates — `diffCapabilities` in `cli/src/pins.ts`; `approve` prompts only when `widened` is true. A new `(target, selector)` pair or a higher value ceiling widens; removing either narrows and passes silently.
- [x] First rug pull blocked on testnet, end to end — refused at `0x1464e35e9231e9e021dc5be743abc456d28a7ff0b528f3ab14286c559c9ba35b`, `SkillHashMismatch`, **zero logs**. Nothing moved.
- [x] Watcher indexed by delegated account; slash path — `watcher/src/equivocation.ts` → `slashEquivocation`. Note the offence is *equivocation* (two skill hashes claimed for one version), not the `proveViolation` shape this line originally assumed.

### Week 3 · Sep 16–22 — Adoption removal
- [x] Sandbox replay on forked Monad → draft capability sets — `sandbox/`.
- [x] `lockstep-action` GitHub Action written and green in CI — `action/action.yml`. **Usable now as `faizydroid/lockstep/action@v0.1.0`**; `uses:` accepts a subdirectory. **Not listed on the Marketplace, and "needs the repo public" was the wrong reason** — the repo is public and it still cannot be listed, because the Marketplace requires one action per repository with its metadata at the repository *root*. `scripts/publish-action-repo.mjs` generates the standalone repo that satisfies that; ticking the listing box is a web-UI step. See [README](README.md#why-the-action-is-not-on-the-marketplace).
- [~] Envio indexer — config points at the live registry from block 59428872, 13 events. Codegen cannot run on Windows, so it is verified by the Linux CI job, **not yet running as a hosted deployment**.
- [x] Invariants — `contracts/test/Invariants.t.sol`, seven of them: locked never exceeds balance, locked equals the sum of live pin bonds, the registry holds what it owes, a bond is never paid twice, live pins stay fully bonded, revoked pins are never live, and `versionPinCount` equals the number of unslashed claims per version. The seventh was added with the fix for a bond that stayed frozen after a successful challenge — too high strands honest collateral forever, too low is revoke-and-run.
- [ ] **Sep 18–19 NYC Metropolis Lounge — go.** Judges and mentors are physically present. SF/London Sep 25, Singapore Oct 6 as alternates.

### Week 4 · Sep 23–29 — Surfaces
- [x] Install-time UI: pin line, capability diff, approval queue — seven routes: `/`, `/pins`, `/approvals`, `/drift`, `/bonds`, `/publishers`, `/badge`. `/publishers` also reads the live Lens, and states in the interface that on this deployment the only publisher and the configured account are the same address, so the filter has nothing to exclude yet. That caveat is grepped for by `scripts/check-export.mjs`, because the honest panel and the overclaiming one look identical.
- [x] `lockstep-provenance` skill in MetaMask's own `domains/<domain>/skills/<name>/skill.md` layout → **MetaMask bounty**. Teaches a Gator operator when a `functionCall` scope is insufficient. Named to avoid colliding with the existing `skill/SKILL.md`, which does a different job.
- [x] `LockstepLens` over ERC-8004 — **live at `0x3338c4F5c8eEFeACF8e41d6ac47B63c466175664`**, block 59619349, reading the real registries. `script/DeployLens.s.sol` identifies the registries on chain before it will deploy, and refuses otherwise; `test/DeployLensChecks.t.sol` (15 tests) proves those checks fire on the live `tokenURI` payload and reject a lookalike. Immutables read back off chain, and the eligibility rule answers correctly against live state in both directions.
- [x] Embeddable badge — `badge/`, plus the `/badge` route.
- [ ] **First 3 third-party skills pinned**

### Week 5 · Sep 30 – Oct 6 — The demo that wins
- [x] **Reproduce a ClawHavoc-class rug pull.** `demo/skills/kuru-quote` clean at approval, `demo/attack/kuru-quote-hostile` after the silent update, refused at settlement on testnet.
- [x] Show the same attack against an allowlist-only wallet, then blocked by Lockstep — `contracts/test/AllowlistComparison.t.sol`, and `contracts/test/GatorComparison.t.sol` does the same against MetaMask Gator's real `functionCall` caveat rather than a straw man.
- [x] Bond-velocity benchmark: 6s window vs 4min window — `contracts/test/BondVelocity.t.sol`. This is the number the monetisation argument rests on.
- [ ] `lockstep-action` merged into at least one real publisher's CI
- [ ] **Target 5+ third-party pinned skills**
- [ ] External review; fix everything found

### Week 6 · Oct 7–13 — Ship
- [ ] **Freeze Oct 9.** Bug fixes only.
- [ ] Mainnet deploy with real pins and real bonds
- [ ] 3-minute rehearsed, captioned video
- [ ] Write-up
- [ ] **Submit Oct 11.** Non-negotiable.

---

## 8. Demo script (3 minutes)

1. **0:00–0:20 — The number.** "341 malicious skills. 300,000 users. Prompt injection defeats model guardrails 57 to 72 percent of the time. You cannot fix this at the model layer."
2. **0:20–0:45 — The gap.** MetaMask Agent Wallet caps *how much* an agent spends. It has no idea *which code* asked. Show a poisoned description slipping past an allowlist untouched.
3. **0:45–1:30 — The rug pull, live.** Approve a clean skill. Publisher silently ships a hostile update. Agent tries to move funds. **Reverted before settlement.** Show the block number and the `RugPullBlocked` event.
4. **1:30–2:00 — Why it doesn't annoy anyone.** Capability-identical update: auto-approved, no prompt. Capability widened: a diff and an explicit ask. Show the auto/explicit ratio.
5. **2:00–2:30 — Why Monad.** Gas for the hash check. Bond velocity table: 6 seconds vs 4 minutes, ~40x capital efficiency.
6. **2:30–3:00 — Why it spreads.** `lockstep-action` in a real publisher's CI, N third-party skills pinned, the badge. Then: AIR raised $50M to *scan* this problem on Sept 1. Lockstep *enforces* it, on-chain, at settlement.

Record it. Do not perform it live.

---

## 9. Bounty mapping

| Bounty | $ | Deliverable | Path |
|---|---|---|---|
| MetaMask Best Agent Wallet Plugin | 2,500 | `lockstep-provenance` skill + a 12-test differential against Gator's `functionCall` caveat | `integrations/metamask/`, `contracts/test/GatorComparison.t.sol` |
| Privy | 5,000 | client auth + server wallets for demo agents | `app/`, `agents/` |
| Envio | 1,000 | HyperIndex over ERC-8004 + Lockstep events | `indexer/` |
| Chainlink CRE | 3,000 | cron workflow for epoch rollover / pin-staleness alerts | `workflows/` |
| Nansen | 5,000 | publisher and counterparty risk enrichment | `indexer/enrich/` |
| Cleanverse CVI/CVA | 2,000 | verified identity for institutional publishers | `contracts/` |
| Alchemy | 1,000 cr | RPC + webhooks | infra |
| Kimi / Qwen / Hunyuan | 10,000 cr | demo agent reasoning | `agents/` |
| **Track 04** | **30,000** | — | — |
| **Grand champion** | **25,000** | — | — |

ERC-8004 is co-authored by Marco De Rossi at MetaMask. Spec fidelity is directly legible to the people judging.

---

## 10. Risks and pre-agreed cuts

| Risk | Response |
|---|---|
| **Runtime hash reporting impossible** | Week-1 kill gate. Stop the project rather than fake it. |
| **Permission fatigue** | Auto-approve unless capabilities widen. Report the ratio. |
| **Publisher declares wide capabilities and stays compliant** | Bond priced by declared blast radius. |
| **Guard bug bricks accounts or drains funds** | Smallest contract in repo, fail-closed, most-tested, unconditional user revoke. |
| **Indirect injection walks past this** | **State it plainly in the write-up.** Lockstep bounds skill-origin financial harm, not all harm. A judge who finds this themselves discounts everything else. |
| **Forced upgrade / revocation** | Publisher can mark a pin as compromised; users get a blocking alert. Design in week 2. |
| **Mechanism copied by a competitor** | Distribution over invention. CI integration is the priority, not contract elegance. |
| **Scope blowout** | Three contracts. One runtime. No cross-chain. No TEE. No vault. No custom manifest format. |

**Non-negotiables:** the live rug-pull block, the auto/explicit approval ratio, gas + bond-velocity numbers, mainnet deployment, third-party pinned skills, and submitting Oct 11.

---

## 11. Repo layout

```
monad_project/
├─ contracts/
│  ├─ src/
│  │  ├─ PinRegistry.sol
│  │  ├─ LockstepGuard.sol        ← smallest, most tested
│  │  ├─ LockstepLens.sol
│  │  └─ interfaces/              ERC-8004 registries
│  ├─ test/                       unit · fuzz · invariant
│  └─ script/                     deploy 143 / 10143
├─ runtime/                       skill hashing + tx attachment (WEEK 1 GATE)
├─ action/                        lockstep-action (GitHub Action)
├─ sandbox/                       Anvil fork replay → draft capabilities
├─ watcher/                       Fargate, indexed by delegated account
├─ skill/                         OpenClaw skill routing spend through lockstep_send
├─ integrations/metamask/         lockstep-provenance skill, MetaMask's layout
├─ indexer/                       Envio HyperIndex
├─ app/                           Next.js: pins, diffs, approval queue, badge
├─ agents/                        demo agents incl. the rug-pull attacker
└─ bench/                         gas · bond velocity · attack reproduction
```

---

## 12. Name candidates

Provisional name is **Lockstep**. Collision checks below reflect searches on 2 Sep 2026 and are not a substitute for a trademark search.

### Recommended

| Name | Why | Collision risk |
|---|---|---|
| **Lockstep** | "The version that runs moves in lockstep with the version you approved." Instantly understood with zero explanation — which matters when 55 judges see it for three minutes. | Low in this space. A Lockstep exists in accounts-receivable software (different market). |
| **Detent** | A mechanical device that holds a mechanism in a fixed position until deliberately released. Precisely the mechanism. Fully ownable, four-letter CLI (`detent pin`). | None found. Risk is comprehension — people may read it as "détente." |
| **Ward** | A ward is the ridge inside a lock that blocks the wrong key, *and* it means to guard. Genuine double meaning, four letters. | Common word, so search visibility is poor. |

### Also viable

| Name | Why | Collision risk |
|---|---|---|
| **Hasp** | Hinged fastener that receives a padlock. Short, physical, very ownable. | None found. Slightly harsh sound. |
| **Latch** | Best pure semantic fit for "holds in a fixed state." | Latch Inc / DOOR is a public smart-access company. Different industry, same word. |
| **Provenant** | From provenance, which Track 04 names explicitly. Sounds like a company. | Low. More abstract, needs a tagline. |
| **Tumbler** | The pin stack inside a lock — mechanically exact. | Phonetically close to Tumblr; "tumbler" also means crypto mixer. Avoid in crypto. |
| **Imprint** | Evokes a fixed impression. | imprint.co is a fintech card company. Moderate. |

### Rejected after checking

| Name | Why not |
|---|---|
| **Cinch** | Heavily occupied in this exact space: `cinch-ai-security` on PyPI does agent runtime containment, and cinch.codes sandboxes untrusted AI code. |
| **Clinch** | `clinchprotocol` is agent-to-agent negotiation. |
| **Harness** | Harness.io is a major CI/CD company — a fatal collision given we ship a CI action. |
| **Assay** | No longer describes the product. We pin provenance; we don't test purity. |
| **Anchor** | Anchor Protocol's collapse makes it toxic in crypto. |
| **Sentinel / Sentry** | Sentry is already a Monad ecosystem project. |
| **Deadbolt** | DeadBolt is a known ransomware family. Fatal for a security product. |
| **Rivet** | Rivet is wevm's Ethereum developer wallet — same ecosystem. |

**Recommendation:** ship the hackathon as **Lockstep** for comprehension, and register **Detent** as the long-term trademark if the project continues. Comprehension wins a three-minute demo; ownability wins a company.

---

## 13. Sources

- [Metropolis tracks and bounties](https://www.monad.xyz/developers/hackathons/metropolis)
- [Monad Agent Hub](https://app.monad.xyz/agents)
- [ClawHavoc supply chain attack](https://repello.ai/blog/clawhavoc-supply-chain-attack)
- [Malicious OpenClaw skills teardown](https://repello.ai/blog/malicious-openclaw-skills-exposed-a-full-teardown)
- [Trend Micro: AMOS via OpenClaw skills](https://www.trendmicro.com/en_us/research/26/b/openclaw-skills-used-to-distribute-atomic-macos-stealer.html)
- [Trellix: OpenClaw supply chain crisis](https://www.trellix.com/blogs/research/when-agents-go-rogue-openclaw-supply-chain-crisis/)
- [OpenClaw security incidents, enterprise lessons](https://www.growexx.com/blog/openclaw-security-incidents-enterprise-lessons/)
- [SkillGuard: a permission framework for agent skills](https://arxiv.org/html/2606.03024v1)
- [Attack-surface survey of MCP, skills, and tool calling](https://arxiv.org/html/2608.17275)
- [Tool description poisoning skips your allowlist](https://agntid.substack.com/p/tool-description-poisoning-skips)
- [MCP tool poisoning and rug pulls](https://glasp.co/articles/mcp-security-tool-poisoning-supply-chain)
- [Securing MCP against tool poisoning](https://arxiv.org/html/2512.06556v1)
- [OWASP Agentic Skills Top 10 · Universal Skill Format](https://owasp.org/www-project-agentic-skills-top-10/universal-skill-format)
- [SkillBond Protocol](https://skillbond-protocol.vercel.app/)
- [AIR raises $50M to vet agent skills](https://techcrunch.com/2026/09/01/air-raises-50m-to-help-companies-vet-the-skills-and-add-ons-ai-agents-use/)
- [ERC-8004 specification](https://github.com/ethereum/ERCs/blob/master/ERCS/erc-8004.md)
- [ERC-8004 on Monad](https://docs.monad.xyz/guides/erc-8004)
- [Monad EIP-7702](https://docs.monad.xyz/developer-essentials/eip-7702)
- [Mera passkey accounts](https://docs.monad.xyz/guides/mera)
- [agent0-ts SDK](https://github.com/agent0lab/agent0-ts)
- [MetaMask skills for OpenClaw](https://github.com/MetaMask/skills)
- [MetaMask Agent Wallet launch](https://www.cointribune.com/en/metamasks-agent-wallet-lets-ai-trade-without-giving-it-the-keys-to-your-crypto/)
- [Agora API](https://docs.agora.finance/api)

*Content from external sources was rephrased for compliance with licensing restrictions.*
