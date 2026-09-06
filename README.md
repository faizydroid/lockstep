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

`LockstepLens` needs no row in that table, and the reason is structural rather than an
oversight: every function it has is `view`, so there is nothing to sign. viem's
`readContract` narrows `functionName` to the view and pure entries of an ABI, so a write
added to the Lens later could not reach the read path even by mistake — it would fail to
compile at the call site.

### The browser attack surface, and what the mitigations do not buy

A dashboard for a supply-chain security product is a bad place to have a scripting bug, so the surface
is enumerated rather than assumed. What follows is what was checked, and each item says where it stops.

**Untrusted input is exactly two things: the URL and `localStorage`.** Both are fully controlled by
whoever hands a reader a link or reaches this origin with a script, so both go through a parser.
`lib/settings.ts` covers storage and `lib/untrusted.ts` covers the URL. Storage refuses non-object
JSON, `javascript:`/`data:`/`file:` URLs, plain http off loopback, URLs carrying credentials, the zero
address, negative block numbers, truthy-but-not-`true` booleans, and step ids outside
`[a-z0-9-]{1,40}` — so nothing arbitrary out of storage can reach the DOM. The `?pin=` query param is
validated to a 32-byte hex id. That last one fixed no live bug: a bogus id already matched no pin. It
was changed because holding an unbounded attacker-supplied string in state that several components
read is the shape a real bug grows from.

**One HTML sink, and it takes no input.** The only `dangerouslySetInnerHTML` in the app is the
pre-paint theme script, which is a module constant.

**`href` is the vector React does not close for you.** Text is escaped; URLs are not, and
`javascript:` in an anchor is a working script. `Button` accepts an `href` and renders an anchor, so it
now checks `isSafeHref` and **fails closed to a disabled button**. Allowed: a fragment, a
root-relative path, absolute https. Refused: both executing schemes, `javascript:` disguised with
control characters (browsers strip those *before* parsing the scheme, so `java\nscript:` runs),
scheme-relative `//host` which reads like a path and is not one, and plain http. Nothing is
sanitised — rewriting an attacker's URL into a slightly different attacker's URL is not a defence.

**Zero production dependency vulnerabilities**, `npm audit --omit=dev`. The app adds no wallet SDK:
identity is EIP-1193 through viem, which was already a dependency.

**The CSP is real, and it is not XSS-proof.** `script-src` needs `'unsafe-inline'` for Next's own
bootstrap and the theme script, and a static export cannot use nonces because a nonce has to be minted
per response and there are no responses to mint it in. Saying so matters more than the header does.
What it genuinely buys: `object-src 'none'` kills plugin embeds, `base-uri 'none'` blocks base-tag
injection which would silently repoint every relative URL on the page, `form-action 'none'` is
meaningful precisely because this app has no forms so any that appear are not ours, and
`frame-ancestors 'none'` stops the dashboard being framed by a page that wants a reader to believe
they are approving something.

**Three protections cannot be expressed in markup at all.** `frame-ancestors`, `X-Frame-Options` and
`Referrer-Policy` are header-only, so the `<meta>` CSP in `layout.tsx` is *not* equivalent to a
configured host and does not pretend to be — it omits `frame-ancestors` rather than declaring a
directive that would be ignored. `scripts/serve-export.mjs` sends all of them and is the reference for
what a real deploy should configure. Verified by request: six headers present, all four hard directives
in the CSP, every route still rendering under it, and `..` traversal refused three ways.

`referrer-policy: no-referrer` is not incidental. Pin ids and account addresses live in these URLs, and
a `Referer` header would leak which skills an organisation is watching to any host it navigated to.

**What is still open.** No Subresource Integrity, because everything is same-origin from the export.
No `Clear-Site-Data` on disconnect, so `disconnect()` clears our stored intent and nothing more —
which is already named in `identity.tsx`, since EIP-1193 has no way to make a wallet forget a site.

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

## Measured against MetaMask Gator

`AllowlistComparison.t.sol` argues this project's case against a spend-limit wallet this
repo wrote. That is a fair rendering of the category and it is still a control we invented
in order to beat it. So the same argument is made again in
[`contracts/test/GatorComparison.t.sol`](contracts/test/GatorComparison.t.sol) against the
permission model MetaMask actually ships — 12 tests, no straw man.

Gator grants an agent a delegation with a `functionCall` scope:

```bash
gator grant --to <agent> --scope functionCall \
  --targets <addresses> --selectors <signatures> --valueLte <ether>
```

Targets, selectors, a per-call native value ceiling. **A Lockstep pin declares exactly the
same three things**, and that is worth stating plainly rather than hiding: the two systems
agree completely about *what* an agent may call. `test_lockstepEnforcesTheSameThreeConstraints`
and `test_gatorCaveatsRejectWhatTheyAreFor` assert both halves, so adopting Lockstep loses
none of what a Gator caveat already gives you.

They diverge on one axis. The test that carries the whole section is
`test_sameCalldataOneRedeemsTheOtherRefuses`: one `bytes memory hostile`, handed to both
layers in a single test body.

| | Gator delegation | Lockstep guard |
|---|---|---|
| Target allowlisted | yes | yes |
| Selector allowlisted | yes | yes |
| Value within ceiling | yes (zero) | yes (zero) |
| Recipient in the calldata **arguments** | not inspected | not inspected |
| Which code built the calldata | **no parameter for it** | `skillHash`, attested |
| Result | redeems, funds reach the attacker | reverts `SkillHashMismatch`, zero logs |

The gap is in the signature, not the enforcement, which is why no amount of caveat
sophistication closes it. `redeemDelegation(delegation, target, value, callData)` has nowhere
to put the identity of the code that produced `callData`; `execute(pinId, skillHash, calls)`
does. `test_theDifferenceIsAParameter` asserts both selectors by hash, so it fails if either
signature ever changes.

**What is modelled, and what is not.** The caveat enforcement semantics: three enforcer
contracts checked before the delegator performs the call, with terms packed the way the
toolkit packs them. Not the full ERC-7710 wire format — no signature recovery, no delegation
hashing, no authority chains, no ERC-7579 execution modes. Those govern *who* may redeem a
delegation, which is orthogonal to what a redemption is permitted to do once the redeemer is
established. Claiming a complete implementation would be false. The file header says so too.

### EIP-7702 delegation is exclusive, and that changes the integration story

"Use both together" is the obvious thing to claim and it is not quite true. `gator create`
upgrades an EOA to a MetaMask smart account; Lockstep delegates an EOA to `LockstepGuard`.
Same mechanism, and an EOA carries exactly one delegation indicator —
`0xef0100 || implementation`, 23 bytes with room for one address.

`Eip7702ExclusivityTest` establishes this by measurement rather than by reading the spec back:

- `test_anAccountCarriesExactlyOneDelegation` — delegating twice **moves** the delegation, it
  does not stack. `account.code.length` is 23 either way.
- `test_movingTheDelegationTakesTheGuardWithIt` — after the move the guard's entry points are
  gone and the replacement works fine. A silent handover, not a broken account.
- `test_theApprovalSurvivesInStorageWhileUnenforced` — this is the dangerous part. Delegation
  changes code, not storage. The ERC-7201 slot still holds the approval, so anything reading
  storage directly sees an account that looks exactly as it did while it was protected.
- `test_namespacedStorageSurvivesARivalDelegateWritingSlotZero` — a rival delegate keeping a
  counter at slot 0 would flip an approval to `true` if the guard used sequential slots. It
  doesn't, and this is why.

The composition that does work is not the obvious one: the two layers stack **across**
accounts, not on one. A Gator delegation names a delegate, and that delegate can be an address
whose own spending is gated by Lockstep. The funded account carries one indicator; the executor
is a different address that holds no funds and pays its own gas, which is already how Lockstep
is built. `test_theExecutorIsADifferentAddressSoTheLayersStackAcrossAccounts` states it as a
test so it is not merely prose.

The write-up and the skill live in [`integrations/metamask/`](integrations/metamask/), laid out
in MetaMask's own `domains/<domain>/skills/<name>/skill.md` structure. It is marked
`maturity: experimental`, because MetaMask has not reviewed it.

## Why Monad

| Property | What it enables |
|---|---|
| O(1) hot path, 300ms blocks | Enforcement costs ~40k gas, and batching amortises the fixed check to 3.1k per additional call |
| 300ms / 600ms finality | Re-pinning on every release is fast enough not to be painful |
| EIP-7702 live | The guard is a delegate on a plain EOA. No bundler, no paymaster, no deployment |
| Cheap state | Pins are per-skill-version, not per-transaction, so state stays flat as usage grows |

**Measured, not estimated — and read the scope line before comparing these to any other gas
number in this document.**

Scope: the `execute` call alone, on a local EVM, warm state, against a mock target whose
`swap` does almost nothing. solc 0.8.28, optimizer 200. It excludes the 21,000 intrinsic cost
of a transaction and excludes whatever the target actually does. That is the right scope for
the question "what does enforcement cost", because it isolates the guard from the trade.

| Path | Gas |
|---|---|
| Unguarded direct call | 27,113 |
| Through Lockstep | 67,142 |
| **Enforcement overhead** | **40,029** |
| Marginal per extra call in a batch | 3,092 |
| Reject a rug pull | 43,263 |
| `LockstepGuard` deployed size | 3,055 bytes |

There is a second, larger set of figures further down, [measured on Monad
itself](#three-monad-behaviours-worth-knowing), and the two are not in competition — they
measure different things. See [reconciling the two gas
tables](#reconciling-the-two-gas-tables). Reproduce these with `forge test -vv` in
`contracts/`; `contracts/.gas-snapshot` is committed so a change in any of them shows up as a
diff rather than as a number nobody rechecked.

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
skill/       OpenClaw skill routing agent spend through lockstep_send
integrations/metamask/  lockstep-provenance skill in MetaMask's skill.md layout
app/         Next.js dashboard: pins, drift, approvals, bonds, publishers
demo/        An honest skill and its rug-pulled successor
e2e/         Full flow against a live Anvil chain with real 7702 delegation
scripts/     check-export.mjs (verifies the export), serve-export.mjs (serves it)
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
npm run test:unit          # 418 tests across seven packages
npm run typecheck

cd contracts
forge test -vv             # 175 tests, gas and bond-velocity figures in the output

cd ..
npm run test:e2e           # 76 tests against a live Anvil chain
```

**621 tests total**, counted by running all three: 418 unit, 127 contract, 76 end-to-end.

| package | tests |
|---|---|
| `runtime` | 41 |
| `plugin` | 55 |
| `cli` | 38 |
| `sandbox` | 17 |
| `watcher` | 15 |
| `badge` | 28 |
| `app` | 224 |
| `contracts` (Foundry) | 127 |
| `e2e` | 76 |

The e2e suites skip with a message rather than failing if Anvil is not present. They cover
the full flow with real EIP-7702 delegation, the `ChainAdapter` that submits transactions,
every hand-written ABI fragment checked against the compiled artifacts, each package's entry
point run by plain Node, and the GitHub Action's two refusals.

### Closing the last step

Everything except a model credential is automated:

```bash
node scripts/live-dispatch.mjs --provider anthropic --key sk-...            # must land
node scripts/live-dispatch.mjs --provider anthropic --key sk-... --rug-pull # must be refused
```

The harness stands up a chain, deploys, bonds, pins the demo skill's real on-disk hash,
delegates via 7702, installs the plugin, and runs one agent turn. The verdict is read
from `SkillExecuted` logs on chain, not from the model's prose.

### Running the dashboard locally

```bash
npm run build --workspace @lockstep/app
npm run serve                       # http://127.0.0.1:4173
```

`next start` will not work and the reason is in `app/next.config.ts`: `output: "export"` means
the build emits files and there is no Node server to start. `npm run serve` is a small static host
over `app/out`, which has the useful property that **what you look at locally is byte for byte the
artifact CI checks** — `next dev` would build and serve a different application.

It binds to `127.0.0.1` and has no authentication, which is the correct amount for what it serves:
every byte is public, the pages are read-only views over public chain state, and the bundle
deliberately cannot encode a transaction that asserts anything. `--host 0.0.0.0` exposes it on the
network if you want to show someone, and is opt-in rather than the default.

Live rather than fixtures, provided the config below is set. Verified by running the dashboard's own
`loadSnapshot` outside the browser against Monad testnet: `source.kind` came back `chain` at block
59640065 in 14s, with one bonded pin, one publisher, one approval, two executions, and the Lens
reporting the delegated account as an eligible reviewer. Without configuration the pages still
render, from fixtures, and the banner says so.

Copy `.env.example` to `app/.env.local` and set the five `NEXT_PUBLIC_*` values recorded there;
`NEXT_PUBLIC_DEPLOY_BLOCK` is the one people miss, and without it log queries start at genesis, the
public RPC refuses, and the dashboard falls back to samples while looking correctly configured.

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

**Bonds are priced by breadth, not by value.** An early version sized bonds against the pin's
native-value ceiling, which is close to useless: a swap skill calls
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

## How this gets distributed

One mechanism, and it is the badge. A publisher who posts a bond has done something costly and
reputationally positive, and the badge is the proof — so the thing they want to show off and the thing
that spreads the registry are the same object. Nothing else here is a growth tactic.

**It arrives at the moment of maximum reason to want it.** `lockstep publish` used to end with a
transaction hash. A hash is a receipt. It now writes the SVG into the skill directory and prints the
paste-ready line, because the only point in the flow where someone has just done the costly thing and
is watching a terminal is right then. The GitHub Action does the same in its run summary, which is
where a publisher looks after CI, with the SVG in a collapsed block.

**The badge is a file, not a URL, and that decides everything else.** A hosted badge —
`https://…/badge/<pin>.svg` in an `<img>` — reports every README view to whoever runs the host: which
repositories carry a pin, how often they are read, from where. For a supply-chain security product that
is a map of its own users' security posture, served to a third party. So there is no badge host and
there will not be one. The publisher commits the SVG and references it relatively; the link beside it is
absolute and goes to the live registry, because a badge nobody can check is decoration.

**The cost of that, stated rather than skipped: distribution with no measurement.** Nobody can count
badge impressions or attribute a visit to one. The only available signals are GitHub code search for
`lockstep-*.svg` and referrer-less traffic to the dashboard — and `Referrer-Policy: no-referrer` is set
deliberately, so even that is thin. Every growth playbook assumes you can instrument the funnel. Here
the highest-value surface is structurally unmeasurable, and the alternative was a tracker.

**Amber is what makes green worth having.** A bonded pin that can still call
`approve(address,uint256)` renders amber, not green: the publisher is accountable *and* the power is
real. A badge that were always green would be decoration, and the distinction is what makes a green one
a claim.

Two things were considered and rejected. A referral or points scheme, because a reward bolted onto
something nobody wants to show off does nothing, and the badge already works without one. And anything
resembling engagement inflation — bought installs, seeded reviews, name-squatting on trending terms —
which for a product whose entire pitch is verifiable provenance would refute the pitch.

## How this makes money

Marked by how defensible each line is, because a plan that presents a guess and a
measurement in the same typeface is not a plan.

### The constraint that determines everything

The cost of enforcement is negligible: the guard adds **40,029 gas** to a call that would
otherwise cost 27,113, and a whole guarded transaction settled on Monad testnet came to
115,207 gas including the trade it was wrapping. Either way, at testnet fee levels it is a
rounding error. Nobody will decline this because the gas is too expensive.

Those two numbers used to appear in this document 200 lines apart with no relationship
stated, which reads as one of them being wrong. They measure different scopes; see
[reconciling the two gas tables](#reconciling-the-two-gas-tables).

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
publishing, and it cannot be gamed by inflating the protocol's own usage. Almost every
monetisation mechanic in software rewards more activity; this one rewards catching a specific
lie, and there is no way to manufacture more of it from the inside.

**The ceiling, computed rather than asserted.** At `challengerRewardBps` of 5,000 against the
live bond table, one slash sends between **62.5 and 862.5 AUSD** to `slashRecipient` — half of
a 125 AUSD narrow pin, half of a 1,725 AUSD wide one. So a hundred caught frauds a year is
somewhere between six and eighty-six thousand. That is a real insurance float and it is not a
company, and saying it in numbers is more useful than saying it in adjectives.

Two honest limits. It is not a growth line — revenue correlates with fraud, which is
bounded and should decline if the product works. And a protocol that profits from slashing has
an incentive to be aggressive about what counts as equivocation, which is why the definition
lives in an immutable contract (two live pins sharing one `versionId`) and not in anyone's
discretion. That immutability is also a **pricing commitment**: publishers lock capital under a
published rule, and changing `challengerRewardBps` later would retroactively reprice collateral
that is already posted. It cannot be changed, which is the strongest promise this protocol can
make to the people whose money is sitting in it.

### The line that turns the barrier into revenue

Everything above treats bond capital as a cost to be minimised. That is accurate and
self-limiting, and it is the one place this plan was thinking too narrowly: when price is the
barrier, the answer is rarely to lower it. It is to change **who pays**.

**Bond underwriting.** A third party posts a publisher's bond; the publisher pays a recurring
premium far smaller than 1,725 AUSD of locked capital; Lockstep prices and routes the market and
takes a fee on the premium, never holding the principal.

This is the most defensible line here because it only works where the slashing rule is immutable
and the challenge window is short — which is the 40x argument from above, restated as an
underwriting pitch. A shorter window means less capital per unit of value secured, and that is
precisely what an underwriter prices. It converts the stated adoption barrier into recurring
revenue instead of fighting it, it does not violate the rejected publish fee (the charge is
optional, falls on capital provision rather than on releasing, and *lowers* a publisher's cost
of entry), and it finally gives `slashRecipient` an economic function beyond pointing at the
deployer: the slash share becomes the loss reserve.

Two constraints to keep honest. Surety is regulated-adjacent in most jurisdictions, so this
starts as a marketplace rather than as the underwriter of record. And underwriting must never be
able to influence what counts as equivocation — which the immutable definition already
guarantees, and which is the reason that immutability was worth having before there was a
business reason for it.

**Paid monitoring, revenue-shared out of the challenger half.** Detection is already built,
pure and node-free, and slashing is permissionless — so the challenger's 50% is a bounty the
protocol already pays to whoever is watching. Sell continuous monitoring to the parties who lose
when a publisher equivocates, and share recovered bond with subscribers. The incentive stays
honest because subscribers pay for detection and are paid out of proven fraud. It also hardens
the admission above: shrinking fraud becomes a monitoring subscription that persists rather than
a revenue line that evaporates.

### Who else has a reason to pay

Worth asking explicitly, because every line above draws from one of two pockets: the publisher,
or a fraudster's bond. That is a narrow base, and it is not the only one available.

The parties who bear the loss when an agent moves money through swapped bytes are not only
publishers. Underwriters of that loss, custodians and exchanges whose users run agents, and agent
platforms that need to demonstrate diligence all have budget lines, and none of them is currently
asked for anything. AIR raising $50M to *scan* skills establishes that funded buyers of assurance
in this category exist — this README already cites that as problem validation, and it is equally
evidence about who writes cheques.

What is **not** on offer: putting a third party's commercial interest inside the trust boundary.
There is a clever mechanic where a user who declines to pay is shown a sponsored offer from an
unrelated brand, and the brand funds the acquisition. It works, and injecting a paid
recommendation into a signing or publishing flow would put a sponsor inside the exact supply chain
this product exists to protect. The moment the CLI recommends anyone, the trust boundary the first
hundred lines of this README establish has an advertiser inside it.

### Deliberately not built

**A fee on `publish`.** There is no fee hook in `PinRegistry` and that is a decision, not
an omission. Publishing pins is the behaviour that makes the registry worth anything — a
registry with no pins protects nobody — so charging per release suppresses adoption
precisely where the network effect comes from. The fee would arrive before the value did.

**Anything that converts by pressure.** Time-limited discounts, limited-quantity offers,
exit-intent discount ladders, a second upsell after a decline. These demonstrably work on a
solitary consumer inside an app session, and all of them are wrong here for the same reason:
the buyer is a security-conscious engineering organisation on a procurement cycle measured in
months, and **deliberation is the behaviour we want.** This README's own case for refusing the
key-in-CI shortcut is that a careful buyer's refusal is correct; pressure tactics around that
argument read as a reason to distrust it. A CLI that re-presents an upsell after a developer
declines one gets uninstalled and written about.

On chain it is worse than tacky. A time-limited bond discount is a temporary reduction in the
collateral securing real value — a sale on the security parameter.

**A consent affordance used as a retention device.** The known trick is a "free trial enabled"
toggle that changes no price and exists because opting in makes cancellation less likely. For a
product whose entire proposition is non-repudiable honesty about what was approved, using a
consent control to reduce exit is self-refuting in a way nothing else on this list is.

**Selling usage data.** The registry is public, so indexing and latency over already-public data
is fine and is a line above. Packaging *which organisations pin which skills, and which
capabilities they permit* is not: that publishes a map of security postures, which is an
attacker's target list.

**Silent price experiments and geographic price discrimination.** Survivable in consumer apps
because buyers do not compare notes. Corrosive here, because developer-tool buyers publish
pricing screenshots and procurement needs a quotable list price. One published price is a
feature.

**A lifetime deal on the hosted plane.** Collecting money before the product exists is a good
idea and is above. A perpetual price against perpetual key custody, hosting and an SLA is not:
the failure mode is not lost revenue, it is a security service someone can no longer afford to
operate.

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
raw key sits in CI. That is the whole wedge, and naming it as one line rather than as a
feature list matters — it is the only item here attached to a refusal a buyer has already
made.

**Packaged, because a list of seven features is not a product.** Three tiers, published
prices, and a meter, since without one there is no expansion revenue and a flat month is a
flat quarter:

| | | per month | metered on |
|---|---|---|---|
| **Free** | The primitive. `lockstep-action`, the CLI, the registry, enforcement. | 0 | — |
| **Signing** | Managed signing for one org. No raw key in CI. | 99 | 5 repos, then 15/repo |
| **Policy** | Org-level capability policy, private registry, the drift queue. | 499 | 25 repos, then 12/repo |
| **Assurance** | SSO, audit export, support, an SLA. | talk to us | seats |

A consumption top-up rather than a forced tier jump for a release burst: a team shipping
heavily one month should not have to move up permanently to absorb it.

**The moat admission.** Managed signing, SSO and audit export are replicable by any competent
team in a quarter. Saying this line has "no on-chain component, which is a point in its favour"
was true about delivery risk and wrong about defensibility — a commodity SaaS layer is exactly
where a competitor arrives first. What makes it defensible is not the SaaS: it is being the
default in CI, and being the thing the registry, the Action and the plugin already consume.
The subscription is downstream of that, not the other way round.

**Money before the product, on purpose.** The sequencing below says nothing is charged yet, and
that is right about fees and wrong about learning. Three paid design-partner agreements, sold
against the private-key objection before managed signing exists, would convert two unknowns —
willingness to pay, and what the unit should be — into banked cash and a committed feedback
group. A customer who has paid wants the product to work; a prospect wants to be shown. It also
does not violate the gating metric, which stays pins published by publishers who are not us.

### What happens if you stop paying

Stated because it is the first question a security buyer asks about depending on a hosted signing
service, and because the answer is good and currently unwritten.

**Pins and bonds are contract state.** They keep working. Enforcement is on chain, it is free, and
it does not check a subscription — a lapsed customer's guarded accounts keep refusing drifted calls
exactly as before. What stops is the hosted convenience: managed signing, the private registry, the
queue.

That is not generosity, it is the only arrangement compatible with the rest of this document. If
enforcement degraded on non-payment, the free primitive would be a hostage and an enterprise buyer
would correctly price it as one. Because it does not, churn lands softly onto the free tier, and the
free tier is the credibility of the paid product rather than a funnel into it.

### Speculative

**A control plane for teams running many agents.** Seat or agent pricing for the approval
workflow, the drift queue and the audit trail. Plausible, and there is no evidence yet
that anyone will pay for it, so it is named and not forecast.

The way to stop restating that is to test it rather than to keep qualifying it: sell three paid
pilots against a described roadmap, explicit about what is not built, and let those three define
whether the unit is a seat, an agent, or approval volume. If nobody pays for the slice, "no
evidence anyone will pay" has been established instead of assumed.

**Ecosystem funding for the layer that must stay free.** Enforcement has to be free permanently,
which means it needs a source that is not a customer — foundation, ecosystem or standards-body
money for the contracts and the reference client. One condition, and it is disqualifying if
unmet: no funder may have any influence over the equivocation definition or the registry's
contents. A neutral registry with a sponsor's thumb on it is not a neutral registry.

### Sequencing

1. **Now.** Nothing is charged. The only metric that matters is pins published by
   publishers who are not us, because every other line depends on the registry being
   non-empty.
2. **Alongside that, not after it.** Paid design-partner agreements for managed signing, sold
   against the private-key-in-CI objection before it is built. This is the change from the earlier
   version of this plan, which put every priced thing after the registry filled. Charging a *fee*
   then is still right; *learning the price* then is late, and a paying design partner is a better
   feedback channel than a prospect.
3. **Then.** Hosted CI pinning as the three tiers above, with published prices.
4. **Then.** Bond underwriting, as a marketplace. It needs the registry to exist first, because
   there is nothing to underwrite until publishers are posting bonds.
5. **Then.** The control plane, if the three pilots say so.
6. **Throughout.** The slash share funds a loss reserve, not payroll. The moment slashing revenue
   is load-bearing for salaries, the incentive that makes it clean stops being clean — which is
   also the argument for underwriting over scaling the slash share: it earns from publishers
   staying honest rather than from catching them out.

For comparison, AIR raised $50M on 1 September to *scan* agent skills for this class of
problem. Scanning is advice. This enforces at settlement, which is why the economic layer
exists at all — and it is also why the enforcement has to be free.

## Status

| Area | State |
|---|---|
| Canonical skill hashing | Done, golden vector locked, 41 tests |
| PinRegistry: bonding, blast-radius pricing | Done, 28 tests |
| Equivocation slashing | Done, 36 tests. Permissionless — and the effective penalty is *half* the bond, not all of it, because the offender can submit the proof themselves. Stated plainly [below](#the-slashing-penalty-is-half-the-bond) |
| Bond accounting invariants | Done, 7 invariants over 4096 calls per campaign |
| LockstepGuard (EIP-7702) | Done, 31 tests, gas measured. The value ceiling is per *batch*; a per-call ceiling over an unbounded batch bounded nothing |
| **Adversarial suite** | **Done, 15 tests.** Each of four exploitable holes run as the attack rather than as a property, against a real delegated account with a real approval. All four worked before this pass; three were free |
| **LockstepLens (ERC-8004)** | 23 unit tests plus 18 covering the deploy script's identification checks. Sybil filter: naive 74 vs filtered 35. **The filter did not filter until this pass** — it believed any contract that claimed an approval. Fixed and [documented below](#the-sybil-filter-did-not-filter). **The live deployment at `0x3338c4F5…75664` predates the fix and needs redeploying** |
| Allowlist-layer comparison | Done, 5 tests. Same calldata, one layer permits, the other refuses |
| **MetaMask Gator differential** | **Done, 7 tests** against a model of the real ERC-7710 `functionCall` caveat, not a straw man. Both layers enforce the same targets/selectors/value ceiling; only Lockstep refuses the poisoned bytes — see above |
| **EIP-7702 exclusivity** | **Done, 5 tests.** An account carries one delegation indicator, so Gator and Lockstep cannot share an account. Approvals survive in storage while unenforced. The layers stack across accounts instead |
| Bond-velocity benchmark | Done, 3 tests. 40x from 300ms vs 12s blocks |
| OpenClaw plugin logic | Done, 55 tests |
| CLI, with self-slash refusal | Done, 48 tests. Also refuses a confusable skill name before spending gas, using the registry's own rule |
| Watcher | Done, 15 tests. Detection is pure and node-free |
| Sandbox draft manifests | Done, 17 tests |
| Badge | Done, 28 tests. Written by `lockstep publish` and surfaced in the Action's run summary. A committed file, never a hosted URL — see below |
| GitHub Action | Done, 13 tests against a live chain. Both refusals verified. Written and green in CI; not yet listed on the Marketplace, which needs the repo public |
| `ChainAdapter` | Done, 12 tests against a live chain |
| **CI** | **Green on all three jobs**, first run ever. It immediately found four defects nothing local could have caught — see below |
| **Envio indexer** | **Codegen runs and the handlers typecheck**, verified on Linux CI. Migrated from the v2 API to v3 |
| End-to-end on a live chain | Done, 76 tests. Includes every ABI fragment checked against the compiled artifacts, and each package's entry point run by plain Node |
| OpenClaw plugin registration | **Verified against a live `openclaw@2026.8.2` Gateway.** Hooks bound, tool registered, trusted policy in the accepted surface, zero diagnostics |
| **Live dispatch (model → `lockstep_send` → chain)** | **Verified both directions** against Claude Sonnet 4.5 on AWS Bedrock. Honest run emitted `SkillExecuted`; the same prompt with swapped bytes was refused with `NOT_PINNED`. See below |
| **Deployed on Monad testnet** | **Live at chain 10143.** Registry, guard and a mock bond asset, verified by reading state back. EIP-7702 delegation installed and exercised. See below |
| **Monad testnet gas** | **Measured**, whole-transaction scope: guard-checked execution 115,207; refusal 62,181. Refusing is cheaper than settling. Enforcement *overhead* is 40,029 measured locally — [the two are reconciled](#reconciling-the-two-gas-tables), not in competition. Both predate the current contracts |
| Dashboard (Next.js static export) | Done, 472 tests, reading the live deployment including `LockstepLens`. The write boundary is enforced structurally, not by convention — see below |
| Account profile and settings | Done. Leads with whether anything is *enforcing* your approvals, because delegation changes code and not storage. Settings may change what is read, never what is claimed without disclosing it — the registry address is deliberately not settable |
| Onboarding | Done. Five steps, all of them conditions on observable state rather than stored ticks, so progress can go down and fixtures satisfy nothing |
| Browser attack surface | Audited. Two gaps closed, CSP in headers and markup, zero production dependency vulnerabilities — see below |
| **ERC-8004 registries on chain 10143** | **Identified on chain**, not copied from docs that render client-side. `tokenURI` returns the ERC-8004 spec URI. Both are UUPS proxies behind one EOA — a declared dependency, and enforcement never reads them. See below |
| ERC-8004 registries on chain 143 (mainnet) | Not checked. The addresses above are testnet |

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

### What the security pass found

A first-principles review of this repository found **four defects, three of them exploitable
for free, and every one of them in a mechanism this document had already described as working.**
They are recorded here in full rather than quietly fixed, because a project whose thesis is
"verify, do not trust the label" does not get to publish a changelog that says "hardening".

Each was fixed, and each fix was checked the same way: disable it, run the suite, confirm the
new tests fail, restore. That number is given for each below, because a test that passes with
and without the fix proves nothing.

#### The version id was attacker-chosen, which made the bond decorative

`publish` took `bytes32 versionId` and never checked it against anything. `computeVersionId`
existed; nothing forced a caller to use it.

That defeated the only slashing condition in the system, for the price of one `cast send`.
Publish 1.0.0 honestly, collect approvals, then republish different bytes under
`versionId = keccak256(<anything>)`. Users still read "1.0.0" because the version string they
see lives in an off-chain manifest. Two contradictory claims about one release now exist and
`slashEquivocation` cannot see a contradiction, because the two pins report unrelated ids.

The honest CLI and the Action both derived the id correctly, which is precisely why nothing
caught it: every test agreed with the tooling instead of testing the contract.

**Fixed** by deriving the id on chain from `(name, version)`, which are now parameters and are
recorded in the `Published` event. That closed a second hole one layer up in the same move:
labels are restricted to printable ASCII, 1–64 bytes, because `"kuru-quote "` and a Cyrillic
`о` both render as the trusted skill while hashing to an unrelated version. The cost is real
and accepted: non-Latin skill names are refused.

#### The Sybil filter did not filter

`LockstepLens` decided reviewer eligibility by staticcalling `isPinApproved(pinId)` on a
candidate and believing the answer.

`isPinApproved` is a one-line view. Any address can implement it, and a contract that returns
`true` unconditionally costs pocket change to deploy and can be cloned to as many addresses as
an attacker wants to fund. So the entire Sybil defence — this contract's stated reason to
exist, the thing the demo puts on screen next to `unfilteredScore` — fell to a stub.

The suite did not catch it because **every Sybil in it was a bare EOA.** An EOA has no code, so
the staticcall fails and the candidate is rejected, which looks like the filter working and
proves only that an address which cannot answer is not counted. Nothing ever asked what happens
when an address answers and lies. Thirteen passing tests coexisted with a filter that did
nothing: disabling the new check fails **7** of them, including the headline demo, which
reported the filtered score as *identical* to the naive one.

**Fixed** by requiring the candidate's code to be an EIP-7702 delegation designator naming this
exact guard, checked with `EXTCODEHASH` before any staticcall. That rests on EIP-3541 — contract
code may not begin with `0xEF` — so a contract can never carry a designator. That dependency is
proved rather than assumed, with a control case that deploys the same bytes behind a legal
prefix to show the test's initcode is sound.

What it buys, stated exactly: every counted reviewer is an account that put the publisher's code
in its own signing path. A forged reviewer now costs a distinct EOA, a signed 7702
authorisation, and one `approvePin` write — tens of thousands of gas, not a bond. A funded
attacker can still manufacture reviewers. They can no longer do it with one contract and a loop.

#### The value ceiling was per call, over an unbounded batch

The guard checked `maxValuePerCall` against each call in a batch, and nothing bounded how many
calls a batch could hold. So a pin declaring a 1 MON ceiling authorised 1 MON, or a hundred,
depending only on how the executor chose to split it — and the executor is the agent, which the
threat model assumes can be compromised.

The number on the approval screen was an upper bound on nothing a user could observe. The
fuzzer produced the attack in one line: 24 calls of 0.075 MON moved 1.80 MON through a 1 MON
ceiling. Disabling the fix fails **5** tests.

**Fixed** by summing the batch and checking the total once, before any call executes, plus
`MAX_CALLS = 32`. The field is renamed `maxValuePerBatch`, because leaving a field called
`maxValuePerCall` while enforcing it per batch would be worse than either honest option. One
number, not two: two numbers constrain the *shape* of spending, and blast radius depends only on
the total.

Scope, precisely: this bounds the value one *transaction* can move. It does not bound lifetime
spend, because an executor can send another transaction. Rate limiting belongs with whatever
holds the funds, and MetaMask's Agent Wallet already does it well. The two compose; neither is
sufficient alone.

#### An honest rebuild destroyed a publisher's capital

`versionPinCount` counted publishes and was never decremented, and `reclaimBond` refuses to
release collateral while a version has more than one claim.

Two consequences, and the second is worse. A publisher whose build is not byte-reproducible —
a different compiler, a timestamp in a bundle, a lockfile that resolved differently — publishes
1.0.0 twice by accident and freezes both bonds with no way out. And after a *successful*
challenge, the surviving pin stayed frozen too, because the count still read two. That pin was
the earlier, honest claim users had actually approved against, and its bond was then locked
forever: not slashed, not returned, not burned. Stranded, with no beneficiary at all.

A frozen-with-no-beneficiary bond is strictly worse than a slashed one. Slashing at least pays
someone and deters something. This paid nobody and deterred nothing.

The old test suite asserted this behaviour on purpose, with the comment "the innocent pin's bond
is still frozen: the contradiction stands." The bug was written down as intent.

**Fixed** by decrementing on slash, so the count means *unresolved* claims. Once a contradiction
has been priced there is nothing left for the freeze to protect. Because challenging is
permissionless, that also hands an honest publisher a way out: prove your own contradiction,
forfeit the offending bond, recover the rest. Disabling the decrement fails **4** tests and
breaks a dedicated invariant.

Rejected on the way: letting `revoke` clear the freeze, and time-bounding it — both are
revoke-and-run, the attack the freeze exists for. Also rejected: making `publish` refuse a
second claim per version, which prevents the bug perfectly and would leave the only slashing
condition in the system with no reachable trigger, turning the bond into a refundable deposit.

#### The slashing penalty is half the bond

Not a defect, and not previously stated: an honest reading of the economics that the arithmetic
makes easy to get wrong in a publisher's favour.

Challenging is permissionless, so **the offender is also a potential challenger.** Nothing stops
a publisher who equivocated from submitting the proof themselves, from an unrelated address, and
collecting `challengerRewardBps` of their own forfeited bond. At the configured 5,000 bps that
halves the cost of the offence: the real penalty is the `slashRecipient` share, not the bond.

This is not fixable by checking `msg.sender != publisher`. A fresh EOA defeats that in one
transaction, and a check that looks like a protection but is not is worse than no check, because
it invites people to price the risk wrong. A privileged challenger set reintroduces a committee;
dropping the reward removes the only funding a watcher has.

So the honest figure is `requiredBond * (10_000 - challengerRewardBps) / 10_000`. The reward
exists to make sure somebody is watching, not to make the offence maximally expensive. A test
pins the number so it cannot drift from this paragraph.

#### There is no name ownership

Recorded in the adversarial suite rather than a defect, because it is a limit rather than a bug.

Any publisher may publish under any name, including one they did not originate. It is not
slashable and should not be: two publishers making different claims about their own code is the
normal case, not a contradiction.

What makes it tolerable is that pins are keyed by `(publisher, skillHash)` and approvals are per
pin, so a squatter inherits nothing — no approval, no reputation, no bond. What they get is a
name collision in a listing, which is a real interface hazard. **Any surface showing a skill
name must show the publisher beside it**, and that is why.

### Live on Monad testnet

> **This deployment predates the current contracts and has not been replaced yet.**
>
> Four exploitable defects were found and fixed after these addresses went live — see
> [what the security pass found](#what-the-security-pass-found). The deployed bytecode
> therefore does **not** match `contracts/src`, and specifically the code at these addresses
> still lets a publisher choose an arbitrary `versionId`, still treats the value ceiling as
> per-call, and its Lens still accepts any contract that claims an approval.
>
> Everything below is accurate as a record of what was deployed and verified. None of it should
> be read as a description of the code in this repository today. A redeploy is prepared and
> simulated (5,589,160 gas, ~1.14 MON) but deliberately not broadcast: it rotates every address
> here, invalidates the transaction hashes cited as evidence, and requires re-establishing the
> demo account's delegation and approvals. That is a decision to take deliberately rather than
> as a side effect of a refactor.

Chain 10143. Every address below has code at it and every immutable has been read back
and compared against the source **as it stood when they were deployed**.

| | address | deployed in block |
|---|---|---|
| PinRegistry | `0xe784a386591cFcE683fAd2C678C8A3c282a9e17b` | 59428872 |
| LockstepGuard | `0xC41eCe384Ee559A30Ed350Ce26ba563B618A3510` | 59428911 |
| MockBondAsset (mAUSD, 6dp) | `0xF9D382a5A851dAe325526ec0Aa1a9773221c033A` | 59428803 |
| LockstepLens | `0x3338c4F5c8eEFeACF8e41d6ac47B63c466175664` | 59619349 |
| Account, delegated via EIP-7702 | `0x209C903f68f169C8e654e0C3C91cAdc4C4A4aFF2` | — |

**The bond asset is a freely mintable mock, and "freely" means exactly that.** `MockBondAsset`
in `script/Deploy.s.sol` has an unpermissioned `mint(address, uint256)` — no owner, no cap, no
access control. Anyone can mint themselves any balance and bond any manifest at zero cost, so
on this deployment **every bond figure below is theatre**: the collateral is real in the sense
that the accounting is correct and the slashing works, and worthless in the sense that nothing
was given up to post it.

That is the right choice on a test chain — requiring a faucet-funded stablecoin to try the
system would stop anyone trying it — and the deploy script `require`s a real `BOND_ASSET` on
mainnet, because a registry whose bonds are worthless is worse than no registry. But a demo
that shows "1,150 mAUSD bonded" without saying the token is free is claiming an economic
guarantee it does not have, so it is said here rather than left for a reader to discover in
the deploy script.

**`LockstepLens` reads the real ERC-8004 registries**, deployed by
`script/DeployLens.s.sol` in tx
`0x02b6e6b3b255b51c457c9a09c3c961d12d01f3b05c77128d76d9bafa92f185ce`. It exists as a
separate script rather than a rerun of `Deploy.s.sol` on purpose: that script builds the
system from nothing and would deploy a *second* registry, which would split the pins and
make every address published here ambiguous.

The script refuses to deploy until the addresses it is handed identify themselves — ERC-721
support, `ownerOf(1)` and `getAgentWallet(1)` both answering, `getSummary` decoding with its
mandatory client set, and decisively `tokenURI(1)` carrying the ERC-8004 spec URI. Those
checks are in the script rather than in a README because a check in a shell history is not
reproducible. `contracts/test/DeployLensChecks.t.sol` tests them against the live payload,
including the case that matters: the reference is base64-encoded, so a plain substring scan
finds nothing and a lookalike serving `{"name":"Agent"}` is rejected.

The Sybil filter then answers against live state, both directions:

| query | result |
|---|---|
| `isEligibleReviewer(0x209C…aFF2, [live pin])` | `true` — that account approves that publisher's pin |
| `isEligibleReviewer(0x…dEaD, [live pin])` | `false`, and no revert — an undelegated address is ineligible, not an error |

The second row is the one that would have broken a naive implementation: a single
undelegated candidate in a batch must not take down the whole query.

**The dashboard reads it, and says what the reading does not prove.** `/publishers` grows a
reviewer panel when `NEXT_PUBLIC_LOCKSTEP_LENS` is set, and the interesting part is a caveat rather
than a number. On this deployment the only publisher and the configured account are the *same*
address, `0x209C…aFF2`, so every candidate the dashboard can honestly offer comes back verified — a
column of green ticks that reads as the filter working when in fact it has been handed nothing to
reject. The panel says exactly that, in those terms, because a demonstration that quietly proves
less than it appears to is the same failure this product exists to prevent, one layer up.

Three consequences worth stating, since they shape what the panel is:

- **The registry addresses are read off the Lens, not taken from config.** `identity` and
  `reputation` are `immutable`, so what it reads is a fact about the deployment; asserting it from
  an environment variable would be a claim about one.
- **No score pair is shown, and the reason is adoption, not code.** `getSummary` is keyed by an
  ERC-8004 agent id, and nothing on chain maps a Lockstep publisher to one — registering an agent is
  the publisher's own act in a registry this project does not own, and the Lens only resolves that
  direction. `NEXT_PUBLIC_ERC8004_AGENT_ID` is deliberately unset. Agent 1 on this chain is real and
  has nine feedback entries, but it is not a Lockstep publisher, so scoring it would put a number on
  screen that means nothing about any skill in this registry.
- **The caveat is checked in CI.** `scripts/check-export.mjs` greps the bundle for the disclaimer
  copy, so a refactor that drops it fails the build. That check exists because the honest version and
  the overclaiming version of this panel are visually identical.

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

Scope: the whole transaction, on a live chain, cold state, wrapping a real ERC-20 transfer.
Includes the 21,000 intrinsic cost and includes the trade itself.

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

> **These on-chain figures describe superseded bytecode.** They were measured against the
> deployment recorded in [Deployed on Monad testnet](#deployed-on-monad-testnet). The
> contracts have since changed — the value ceiling became a per-batch budget, `MAX_CALLS` was
> added, and `publish` takes a struct — so re-measuring needs a redeploy. The local figures
> above are current; these are historical and labelled as such rather than quietly left to
> look current. `contracts/.gas-snapshot` is the reproducible record.

#### Reconciling the two gas tables

This document reports enforcement at 67,142 gas in one place and 115,207 in another. Both are
real measurements and neither is the other's correction, which is worth spelling out because a
reader who spots the gap and gets no explanation is right to distrust every other number here.

They differ in three ways, and the differences account for the gap:

| | local table | Monad table |
|---|---|---|
| what is measured | the `execute` call | the whole transaction |
| intrinsic 21,000 | excluded | included |
| the call being wrapped | a mock `swap` that stores one counter | a real ERC-20 transfer, 39,822 |
| state | warm | cold |

Subtracting the parts the local measurement does not contain — 21,000 intrinsic and 39,822 for
the transfer — leaves roughly 54,000 for the guard and registry on chain against 67,142
locally, and the remainder is cold-storage access that a warm local run never pays.

**Which number to quote depends on the question.** "What does Lockstep cost me?" is the
overhead: ~40k, because the trade was going to happen anyway. "What does a guarded transaction
cost?" is the Monad figure, because that is the bill. Quoting the smaller number for the second
question would be the kind of selective measurement this section exists to make impossible.

One methodological note that makes the Monad column trustworthy at all: it does **not** come
from receipts. Monad receipts report the gas limit rather than gas used, which is the next
finding below.

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

Corroborated again by the `LockstepLens` deploy: `forge script` estimated 1,178,253 gas and
the receipt reported `gasUsed: 1178253` — the same number to the unit, which is not what a
real measurement looks like.

**A 7702-delegated account cannot make a bare value transfer.** Sending 1 wei from
`0x209C…aFF2` to a fresh address reverts and consumes the entire gas limit, reproduced at
21,000, 60,000 and 150,000, with the fee reserve two orders of magnitude inside the balance.
`eth_estimateGas` on the same transfer reports `reserve balance violation`. Decisively:
`cast run` replaying that exact transaction locally reports **success at 21,000 gas** — so the
EVM is satisfied and the rejection happens above it. Contract calls from the same account
work fine; every setup transaction here was one. The mechanism has been observed, not read,
so this is a report rather than an explanation.

Narrowed further since: **contract creation from the same delegated account also works.**
`LockstepLens` was deployed by a `CREATE` transaction from `0x209C…aFF2` while that account
was carrying `0xef0100c41ece…`, and it succeeded. So whatever rejects the transfer is
specific to a plain value send rather than a general restriction on delegated senders, which
narrows the search without closing it.

### The ERC-8004 registries, identified on chain and not from documentation

`PLAN.md` warned that the registry addresses render client-side in
[Monad's ERC-8004 guide](https://docs.monad.xyz/guides/erc-8004) and must not be copied out
of a third-party repo. That turned out to be exactly right: fetching both that page and the
[QuickNode ERC-8004 explorer](https://erc-8004.quicknode.com/networks/monad-testnet) returns a
shell with no addresses in it. So the candidates came from a search snippet, and were then
**identified by calling them** rather than trusted:

| Check | Result |
|---|---|
| `chain-id` | `10143` |
| `name()` / `symbol()` | `"AgentIdentity"` / `"AGENT"` |
| `supportsInterface(0x80ac58cd)` | `true` — ERC-721, as the spec requires |
| `tokenURI(1)` | base64 JSON whose `type` is `https://eips.ethereum.org/EIPS/eip-8004#registration-v1` |
| `ownerOf(1)` vs `getAgentWallet(1)` | same address, so the narrowed interface in `IERC8004.sol` matches |
| `getClients(1)` on the reputation proxy | two real client addresses |
| `getSummary(1, [client], "", "")` | answers, with `clientAddresses` mandatory as the spec states |

The `tokenURI` carrying the ERC-8004 spec URI is what makes this an identification instead of
a plausible guess. Verified addresses are now in `.env.example` with the commands above.

**Both registries are UUPS proxies, and that is a dependency worth declaring.** Their code is
byte-identical and 130 bytes long, forwarding to whatever sits in storage slot
`0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc` — which is
`keccak256("eip1967.proxy.implementation") - 1`, confirmed by hashing the string and comparing.

| | Proxy | Implementation | Size |
|---|---|---|---|
| Identity | `0x8004a818…4bd9e` | `0x7274e874ca62410a93bd8bf61c69d8045e399c02` | 14,474 bytes |
| Reputation | `0x8004b663…88713` | `0x16e0fa7f7c56b9a767e34b192b51f921be31da34` | 10,491 bytes |

The admin slot is zero on both and `proxiableUUID()` returns the implementation slot, so the
upgrade authority is `owner()` on the proxy — UUPS, and `UPGRADE_INTERFACE_VERSION()` reports
`"5.0.0"`, OpenZeppelin v5. Both registries return the **same** owner, and that address has no
code, so a single EOA can replace either implementation.

Worth saying plainly, since it cuts against this project's own thesis: Lockstep argues that
code identity should be pinned, and its reputation input comes from a contract whose code one
key can swap. That is not a flaw in ERC-8004 and not something a reader can fix. What it does
determine is where the dependency is allowed to sit. `LockstepLens` is a pure reader with no
authority and no funds, and **the enforcement path never consults it** — `LockstepGuard.execute`
reads `PinRegistry` and nothing else. The worst an upgrade downstream can do is make a
displayed score wrong. It cannot move money, and that separation is the reason the trust
assumption is acceptable rather than merely disclosed.

## License

MIT.

*Content from external sources was rephrased for compliance with licensing
restrictions. Sources are linked inline.*
