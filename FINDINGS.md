# Week 1 findings

Session 1, 2 Sep 2026. Everything below was measured, not estimated. Reproduce with
the commands in §6.

---

## 1. Kill gate status

| Half | Status |
|---|---|
| Two independent machines derive the same hash for the same skill | **PASS** — golden vector locked, 41 tests |
| Extract a trustworthy hash from the OpenClaw runtime and bind it to a transaction | **MECHANISM PROVEN, DISPATCH UNVERIFIED** — see §9 |

The second half is no longer the open-ended risk it was. There is a concrete
mechanism, it is built, and 46 tests cover its security properties. What has
**not** happened is running it inside a live OpenClaw Gateway with a real model.
That requires an LLM provider credential and a Gateway install, so the remaining
risk is integration, not design.

Do not describe the gate as cleared until a Gateway dispatch is observed.

---

## 2. Design flaw found: EIP-7702 does not intercept the account's own key

**The plan's threat model was wrong.** It assumed a 7702 delegate could constrain
what an agent does with the account. It cannot. EIP-7702 adds code to an EOA; it
does not intercept transactions signed by that EOA's key. A key holder always
retains the ability to sign a plain transaction straight to any target, and the
delegate code never runs.

**Consequence, now enforced in the contract:** the agent must never hold the
account's root key. The account splits in two.

- **Account** — user-controlled key (a Mera passkey EOA fits), holds the funds,
  delegates to `LockstepGuard`, and is the only party that can change policy.
- **Executor** — the agent's own address, authorised in storage, holds no funds,
  pays its own gas, and can only move value by calling `execute` on the account.

`test_executorCannotApprovePins` and `test_executorCannotAuthorizeItselfElsewhere`
lock this in: an agent can never widen its own permissions.

---

## 3. What the system proves, and what it only attests

The plan blurred these. They are different guarantees and the write-up must
separate them.

**Trustless — verified from calldata, independent of any off-chain claim:**
- target is on the pin's allowlist
- selector is on the pin's allowlist
- native value is within the pin's per-call ceiling
- the pin is one the account holder explicitly approved
- the publisher has not revoked the pin

**Attested, not proven — which skill produced the call.** The runtime computes the
hash off-chain and reports it. A compromised runtime can report an honest hash
while executing something else. What the chain provides is a non-repudiable record
binding a transaction to a claimed version, which converts a false claim into
provable fraud against a bond. That is an economic guarantee, not a cryptographic
one.

**Out of scope entirely:** indirect prompt injection from content the agent reads,
and any harm that does not move funds. Lockstep bounds financial blast radius. It
is not a general agent sandbox.

---

## 4. Gas, measured

Warm state, `optimizer_runs = 200`, solc 0.8.28.

| Path | Gas |
|---|---|
| Unguarded direct call (baseline) | 27,113 |
| Same call through Lockstep | 66,746 |
| **Enforcement overhead** | **39,633** |
| Marginal cost per extra call in a batch | 2,792 |
| Reject a rug pull | 43,177 |
| Minimal rejection (unauthorised caller, 1 SLOAD) | 28,196 |
| `LockstepGuard` deployed size | 3,349 bytes |

**Correction to the plan.** It described the hot path as "a hash comparison" and
implied near-free enforcement. Real overhead is ~40k gas, dominated by EIP-7702
delegation resolution and cross-contract reads rather than by the comparison
itself. Note the 28.2k floor: even a rejection that fails after one SLOAD costs
that much, so most of the overhead is structural to 7702, not to guard logic.
Claim ~40k and the batch amortisation, not "free."

**Batching is the strongest number here.** The pin lookup and attestation check
happen once per batch, so call two onward costs 2,792 against 39,633 for the
first — roughly 14x cheaper. An agent that batches its work pays the enforcement
premium once. Lead with this rather than with the single-call figure.

Two optimisations already applied, worth 9,516 gas (49,149 → 39,633):
- folded three separate registry CALLs into one `verify()` (~5.2k)
- removed an `executionCount` SSTORE that cost ~3k per transaction to serve a
  view `SkillExecuted` already provides

---

## 5. Bugs caught by writing the tests

**Dead event on the revert path.** `RugPullBlocked` was emitted immediately before
reverting. The revert rolls the log back, so no indexer would ever have received
it — and the dead emit made rejection cost *more* than a successful execution.
Removed. `SkillHashMismatch(attested, pinned)` carries the same two values in the
revert reason, which survives in the trace. **The watcher must read blocked
attempts from reverted-transaction traces, not from logs.** This changes the
indexer design in the plan.

Worth noting: a `vm.expectEmit` test for that event *passed*, because Foundry sees
the emit before the revert. The test was green and the production behaviour was
broken. Replaced with `test_rugPull_emitsNoLogs`, which asserts the opposite.

**Fabricated storage slot.** The ERC-7201 constant was invented rather than
derived. `test_storageSlotMatchesErc7201Derivation` caught it. Real value:
`0x723bc0536d6998736ca58b10278e77528d6552c6336394144a42647181e0f200`. The test is
permanent: editing the namespace string without recomputing the slot would make
every existing account's approvals unreachable, which in production reads as mass
approval loss.

**Gas measurement methodology.** Foundry resets the access list between `setUp`
and the test body, so the first call measured in any test pays cold-address and
cold-slot costs an agent pays only once. An early reading of the rejection path
was inflated ~40k by this plus `try/catch` overhead. All figures in §4 warm the
path inside the test body first.

**Known-vulnerable dev dependency.** The initial install pinned vitest 3.0.5,
which carries a critical advisory (arbitrary file read and execute when the
Vitest UI server is listening, GHSA-5xrq-8626-4rwp). Bumped to 3.2.7. `npm audit`
reports zero. Shipping a known-vulnerable dependency in a supply-chain security
project would have been indefensible.

**A verification that passed with nothing to verify.** The first Foundry checksum
check compared two empty strings and printed `match: True`. Rewritten to reject
anything that is not 64 hex characters before comparing. Foundry v1.8.1 was then
verified against its published digest
`02d98fc2c573793960ee06b7f642487d483fe30572f7e248804c207334a418d8`.

---

## 6. Canonical skill hashing: `lockstep-skill-hash/v1`

Root preimage:

```
0x01 || u32be(len(scheme)) || scheme || u32be(fileCount)
     || for each file, ordered by UTF-8 path bytes:
        u32be(len(path)) || path || leafHash
```

Leaf preimage: `0x00 || u32be(len(path)) || path || content`

Decisions and why:

| Decision | Reason |
|---|---|
| Scheme id inside the preimage | A future policy change produces provably different hashes instead of silently reinterpreting old pins |
| Length-prefixed paths | Without it, `("ab","c")` and `("a","bc")` share a preimage, so bytes could be shifted between filename and body while holding the hash constant |
| File count committed | A truncated entry list cannot pass as a complete one |
| CRLF/CR → LF for an explicit extension allowlist | `core.autocrlf` rewrites line endings on checkout; without this, every cross-platform install is a false positive. An allowlist rather than a text/binary heuristic, because a heuristic is attack surface |
| UTF-8 BOM stripped | Windows editors add it; it changes nothing semantically |
| Paths NFC-normalised, backslashes unified | macOS stores filenames decomposed; Windows uses backslashes |
| Byte-wise path ordering | `localeCompare` and JS string comparison both vary; byte order is the only ordering a future Python or Go implementation will agree on |
| **`node_modules` is hashed** | Excluding it would let an attacker swap a transitive dependency without invalidating the pin — the exact attack this project exists to stop. Publishers must vendor or ship a lockfile inside the skill directory |
| Only `.git` excluded | Metadata the runtime never loads, and it holds per-clone state |
| Symlinks rejected | Following one covers content the publisher does not control and differs per machine; hashing the link path says nothing about what executes. Neither is acceptable |
| Traversal and absolute paths rejected | A skill must not claim files outside its own root |

Golden vector for `runtime/fixtures/kuru-quote`:
`0x9512467d6db3c673831b97851f475e11eadfdb6aa6ff7503b61d0e9dde483a83`

---

## 7. Reproduce

```powershell
npm install
cd runtime; npx vitest run; npx tsc --noEmit    # 38 tests
cd ..\contracts
$env:PATH = "$PWD\..\.tools\foundry;$env:PATH"
forge test -vv                                  # 26 tests, gas figures in the logs
```

Foundry 1.8.1 lives in `.tools/foundry` (gitignored, checksum-verified on install).

---

## 8. Next, in priority order

1. **Clear the rest of the kill gate.** Hash a skill inside a live OpenClaw run and
   attach it to a transaction. Nothing else matters until this works. Hard stop
   Sep 8.
2. **Confirm ERC-8004 registry addresses on chain 143**, read from the docs in a
   browser and verified on monadscan. Do not copy from third-party repos.
3. **Re-measure gas on Monad testnet.** All figures in §4 are from a local EVM.
4. **Add `lockedBond` accounting and blast-radius bond pricing** to `PinRegistry`.
   Without breadth pricing a publisher can declare wide capabilities and stay
   compliant, which is the hole identified in review.
5. **Invariant suite**, not just fuzz: no approval reachable without an explicit
   `approvePin`, no executor authorised without an explicit call, no pin mutable
   after publication.
6. **Start publisher outreach.** Unscheduled and unstarted. Lead time is four
   weeks and the submission is worth little without third-party pinned skills.

---

# Session 2 findings

Runtime integration. 113 tests total: 26 Solidity, 41 runtime, 46 plugin.

---

## 9. How provenance is established, and why the agent cannot forge it

Researched against OpenClaw's actual API ([hooks](https://github.com/openclaw/openclaw/blob/main/docs/plugins/hooks.md),
[skills](https://github.com/openclaw/openclaw/blob/main/docs/tools/skills.md)),
`openclaw@2026.8.2`.

**The mechanism rests on how OpenClaw loads skills.** Loading is lazy: the system
prompt carries only a condensed list of names, descriptions, and file locations,
and the model calls the `read` tool on a `SKILL.md` when it decides to use one.
So the set of skills whose instructions are in context for a run is exactly the
set of `SKILL.md` files read during it. The plugin observes those reads via
`after_tool_call` with `matcher: ["read"]` and never asks the agent anything.

**The design decision that closes the forgery path: the parameter does not
exist.** An earlier sketch had the plugin overwrite an agent-supplied
`skillHash`. That is weaker than it sounds, because it depends on the overwrite
being correct on every path. Instead `lockstep_send` exposes exactly one
parameter — `calls` — with `additionalProperties: false`. There is no `skillHash`,
no `pinId`, no `skill` field. A poisoned `SKILL.md` has nothing to instruct the
model to fill in. A test asserts the serialised schema contains none of those
strings.

**What a lying agent can achieve: nothing useful.** Suppose it reads an honest
pinned skill and then attempts something hostile. The attestation names the honest
skill, so the on-chain guard confines the call to *that pin's* declared targets,
selectors, and value ceiling. Misattributing provenance cannot widen capability.
And to act at all the agent must attest some approved pin, because `decide()`
blocks on absent and ambiguous provenance. The floor is "confined to a pin the
user already approved."

**Fail-closed paths, all tested:**

| Situation | Result |
|---|---|
| No `SKILL.md` read this run | `NO_SKILL_PROVENANCE` |
| Two or more skills in context | `AMBIGUOUS_PROVENANCE` |
| Skill root outside every configured skills root | `SKILL_OUTSIDE_ROOTS` |
| Skill cannot be hashed (symlink, unreadable, mid-run mutation) | `HASH_FAILED` |
| Exact version not approved | `NOT_PINNED` — this is the rug pull |
| No run id in context | `NO_RUN_CONTEXT` |
| A `read` that errored | Ignored; a failed read put nothing in context |

Ambiguity blocks rather than guesses. With two skills in context either could have
influenced the call, so attributing it to one would be presenting a guess as a
fact. Multi-skill attestation is future work, not a silent default.

Provenance is keyed by **run**, not session. A session spans many runs, and an
agent that read a pinned skill an hour ago must not inherit its authority now.
`agent_end` releases the record, which is also what stops a long-lived Gateway
from accumulating one entry per run forever.

OpenClaw's runner treats a thrown or timed-out `before_tool_call` handler as
fail-closed and blocks the call, which is the posture we want. The plugin does not
swallow errors to keep an agent running.

---

## 10. The exec gate is not a security boundary

The plugin blocks `exec` commands that look like transaction broadcasts
(`cast send`, `mm send`, `forge script --broadcast`) via
`registerTrustedToolPolicy`, which runs ahead of ordinary `before_tool_call`
hooks so an installed plugin cannot outrank it.

**It is defence in depth and nothing more.** Shell pattern matching cannot be made
sound: `c""ast send`, `$(echo cast) send`, a renamed binary, or a wrapper script
all evade it. Tests assert those evasions explicitly, as documentation rather than
as defects.

**The real boundary is key custody.** The agent's executor address holds no funds,
so a `cast send` it manages to run can only spend from a key it already has —
which by design is not the account holding the money. The gate exists to catch
misconfiguration and return a clear error instead of a confusing on-chain failure.

It errs toward blocking: `echo cast send` is refused. A harmless false positive
costs a retry; a false negative would matter. A test pins that behaviour so nobody
later "fixes" it into a false negative.

---

## 11. Hashing scheme bumped to v2: executable bit

OpenClaw's own skill revision hash covers "portable file paths, exact content,
sizes, and executable flags." Ours omitted the executable bit, which is a real
gap: `chmod +x` on a helper script changes what runs without changing a byte of
content. A skill that can invoke `./run.sh` behaves differently from one that
cannot.

Leaf preimage is now:

```
0x00 || u32be(len(path)) || path || u8(executable) || content
```

The executable byte sits between path and content so it cannot be absorbed into
either: content cannot claim it because the path length is already fixed, and the
path cannot claim it because it comes after the declared length. A test proves an
executable empty file does not collide with a non-executable one-byte file.

**Scheme id bumped `v1` → `v2`, deliberately.** §6 states that a policy change
requires bumping `SCHEME_ID` rather than editing the golden vector. This was the
first chance to follow that rule, and the golden-vector test caught the change
exactly as designed. Both the runtime vector and the Solidity test constant were
updated together.

New golden vector for `runtime/fixtures/kuru-quote`:
`0x9c66b961fe093d92b35dfed90ec234d617fa4f77899c4871f4e734b1dd5b757b`

**Known limitation, stated rather than hidden.** Windows filesystems cannot
represent the executable bit, so a skill containing an executable script hashes
differently on Windows than on Linux. Mitigation: publishing runs in CI on Linux
and the GitHub Action is the only sanctioned path to a pin. A developer hashing
locally on Windows is inspecting, not publishing. A better fix — declaring the
executable set in the manifest so the commitment is platform-independent — is
worth doing before any third party pins a skill.

---

## 12. What is still unproven

Ranked by how much it would hurt to discover late.

1. **Live Gateway dispatch.** The plugin is built against the documented hook
   contract and tested against a replayed hook surface. It has not run inside a
   Gateway. Needs: `npm i -g openclaw`, an LLM credential,
   `openclaw plugins install --link ./plugin --force`, and an observed
   `lockstep_send` call. **Until this happens the gate is not cleared.**
2. **`after_tool_call` param shape for `read`.** The handler accepts `params.path`
   or `params.file_path` because the exact field name for the `read` tool is not
   documented on the hooks page. If neither matches, provenance is never
   established and every call blocks — loud and safe, but broken. Confirm against
   a real event.
3. **Whether `registerTrustedToolPolicy` is reachable from a linked local
   plugin.** The docs require installed plugins to declare each policy id in
   `contracts.trustedToolPolicies`. The manifest does not yet declare it, so the
   plugin currently falls back to a high-priority ordinary hook and logs a
   warning.
4. **Gas on Monad testnet.** All figures in §4 are from a local EVM.
5. **`lockedBond` and blast-radius bond pricing.** Still absent, so a publisher
   can declare wide capabilities and remain compliant.
6. **Publisher outreach.** Still unstarted, still the thing that decides whether
   the submission is a company or a prototype.

---

## 13. Reproduce

```powershell
npm install
npm test --workspaces                           # 41 runtime + 46 plugin
cd contracts
$env:PATH = "$PWD\..\.tools\foundry;$env:PATH"
forge test -vv                                  # 26 tests, gas in the logs
```

---

# Session 3 findings

Bonding, CLI, chain adapter, deployment, and a live end-to-end run.
**182 tests: 54 Solidity, 41 runtime, 46 plugin, 38 CLI, 3 end-to-end.**

---

## 14. The bond pricing model was wrong, twice

> Naming note, since this section predates a rename: the pin field discussed here was called
> `maxValuePerCall` throughout, and is now `maxValuePerBatch`, because enforcing it per call over
> an unbounded batch enforced nothing. See §38. The pricing argument below is unaffected — it is
> about why the ceiling is the *wrong basis for a bond*, whatever its scope.

**First error: pricing against native value.** The original design sized bonds
against the pin's native-value ceiling. That is close to useless. Almost nothing interesting
moves native value — a swap skill calls `router.swap(...)` with `value == 0` and
moves tokens through an allowance the account granted earlier. A native-value
ceiling does not constrain it at all.

What determines blast radius is **which functions a skill may call**. A skill
permitted to call `approve` on a token can hand unlimited allowance to an
attacker-controlled address, which is categorically worse than one permitted to
call `swap` on a known router. Pricing now keys on:

- capability count (breadth)
- how many of those selectors grant or move tokens or relocate authority (severity)
- whether native value moves at all (a flat premium)

This closes the hole identified in review, where a publisher declares sweeping
capabilities, never violates its own manifest, stays perfectly compliant, and
drains users anyway. Declaring power costs money proportional to the power.

**Second error: mixing units.** The replacement charged
`ceiling * valueCoverageBps / 10_000` and added it to a bond denominated in
AUSD. Bond is 6 decimals; native value is 18. Multiplying them is dimensionally
meaningless without a price oracle, and the first test run demanded ~1e19 AUSD
units to pin a 10 MON ceiling — a bond of roughly 10 trillion dollars.

Fixed by charging a **flat** premium when the ceiling is above zero. Sound with no
oracle, and it reflects that the dangerous step is having native-value capability
at all rather than the specific ceiling. A regression test asserts the bond for a
wide manifest stays inside a plausible AUSD range, so a future unit mismatch shows
up as an absurd number rather than a confusing revert.

**High-risk selectors are derived, not transcribed.** `HighRiskSelectors.sol`
declares an interface and takes `.selector` from the compiler. A mistyped hex
literal would silently under-price the most dangerous capability there is, which is
precisely what the list exists to prevent. A test asserts all twelve are
registered, and a CLI test asserts the client-side mirror has the same twelve.

---

## 15. `lockedBond`, and what it actually means here

The review flagged that one bond could back unlimited concurrent exposure. In the
original escrow design that meant open jobs. In the pin model there are no jobs — a
pin is persistent — so the correct analogue is: **a publisher's deposited bond must
cover the sum of `requiredBond` across all their live pins.**

`test_oneDepositCannotBackUnlimitedPins` funds exactly two pins' worth and asserts
the third publish reverts. Without this, every claim of collateral in the system is
a lie.

Revocation starts a 7-day unbonding delay before the bond releases. The attack it
exists for: ship a hostile update, drain users, revoke, and pull the bond out in the
same block.

**Duplicate capabilities are rejected.** Padding a manifest with repeats would
inflate the priced capability count without widening real capability, faking an
expensively-bonded pin. Caught on chain and again in the CLI manifest parser, where
the error names the offending entry.

**Capability count is capped at 64.** Partly so publishing cannot be made to run
out of gas, but mainly because a 500-capability pin is not a boundary any human can
meaningfully approve.

---

## 16. Approval is spent on capability changes, never code changes

This is the design that decides whether the product survives contact with users.
Every permission system in computing history has died of fatigue.

| Change | Result |
|---|---|
| Code changed, capabilities identical | auto-approved, logged, no prompt |
| Capabilities narrowed | auto-approved, logged |
| Capabilities widened | explicit approval, rendered as a diff |
| Publisher revoked | refused outright, not warned |

`diffCapabilities` is pure and has 10 tests covering exactly this boundary,
including that the same selector on a new target counts as widening, and that a
falling value ceiling does not.

`lockstep approve` refuses a revoked pin rather than warning about it. The
publisher has said the release is compromised and the guard would reject it anyway;
offering to approve it would be theatre.

---

## 17. What the end-to-end run actually proves

`e2e/test/flow.test.ts` runs against a real Anvil chain with `--hardfork prague`:

1. Deploys through the **same** `script/Deploy.s.sol` that ships, so the test
   exercises production parameters rather than a bespoke deployment.
2. Deploys the demo venue from **forge's compiled artifact**, not an embedded
   bytecode literal, so the deployed code is provably the code in `src/demo`.
3. Publisher mints, approves, deposits, and publishes — then the test asserts
   `lockedBond` equals the quote.
4. Account delegates via **real** `signAuthorization` and sets policy in its own
   storage.
5. Hashes come from the **actual demo directories on disk** via
   `hashSkillDirectory`, not from constants.
6. Honest path executes and the venue's swap counter reaches 1.
7. The hostile version, honestly attested, reverts with `SkillHashMismatch`.
8. An undeclared selector reverts with `CapabilityNotDeclared` even under an honest
   attestation.
9. The swap counter is still 1, proving nothing else landed.

That closes the loop between the two halves: a hash derived from files on disk is
the same value the guard accepts, and the rug-pull artifact in `demo/attack` is
rejected in fact rather than in theory.

---

## 18. More bugs the tests caught

**A `vm.prank` consumed by the wrong call.** `test_publishRevertsWithoutEnoughUnlockedBond`
had `registry.quoteBond(...)` inside the `expectRevert` arguments, after the prank.
`vm.prank` applies to the very next call, so the quote consumed it and `publish` ran
as the test contract with zero bond. The revert data was right but for the wrong
reason — a test that would have passed for a while and then confused someone badly.

**`deny = "warnings"` was failing on cosmetic lints.** Naming conventions and
`multi-contract-file` notes were failing the build alongside real warnings. That is
how the deny setting gets deleted and the substantive protection lost with it. Style
lints are now explicitly excluded so the real ones keep their teeth, and the two
genuine warnings were fixed: an unchecked `approve` return in the fixtures, and
`arbitrary-send-eth` in the demo router, which is intentional and now annotated as
such.

**`forge script --json` return keys.** Named return values are keyed by name, not
position. The e2e parser tries names, falls back to positional, and throws with the
actual key list rather than dereferencing `undefined`.

**A vulnerable transitive `ws`.** viem 2.37.6 pulls a `ws` with a memory-disclosure
and DoS advisory. Pinned viem to 2.56.3; `npm audit` reports zero. That is now the
second time a dependency has arrived with a known advisory in this project, which is
worth noting given what the project is about.

---

## 19. Still unverified, ranked

1. **Live OpenClaw Gateway dispatch.** Unchanged and still the gate. The plugin is
   built against the documented contract and tested against a replayed hook
   surface. Needs `npm i -g openclaw`, an LLM credential,
   `openclaw plugins install --link ./plugin --force`, and an observed
   `lockstep_send` call.
2. **`after_tool_call` param shape for `read`.** The handler accepts `params.path`
   or `params.file_path` because the field name is not documented. If neither
   matches, provenance never establishes and every call blocks — loud and safe, but
   broken.
3. **`contracts.trustedToolPolicies` declaration.** The plugin manifest does not yet
   declare the policy id, so on a host that enforces the declaration the exec gate
   falls back to a high-priority ordinary hook and logs a warning.
4. **Monad testnet gas.** All figures are local EVM.
5. **Slashing.** Bonds lock and unlock; nothing takes them yet. Until slashing
   exists the bond is a credible-commitment signal, not a payout, and the write-up
   must not imply otherwise.
6. **Publisher outreach.** Still unstarted. Still the thing that decides whether
   this is a company or a prototype.

---

## 20. Reproduce everything

```powershell
npm install
npm run test:unit                # 125: runtime, plugin, cli
npm run typecheck

cd contracts
$env:PATH = "$PWD\..\.tools\foundry;$env:PATH"
forge test -vv                   # 54, gas figures in output

cd ..
npm run test:e2e                 # 3, live Anvil chain
```

---

# Session 4 findings

Slashing, ERC-8004 integration, watcher, CI action, sandbox, indexer, badge.
**275 tests: 100 Solidity, 172 unit across six packages, 3 end-to-end.**

---

## 21. Slashing: one condition, chosen by what is decidable

The bond was previously theatre — it locked and unlocked and nothing could take it.
Adding slashing meant answering a question I had been avoiding: **what is an
on-chain-decidable offence?**

A guard refusal is not one; the guard refusing a call is the system working. "The
skill did something harmful within its declared capabilities" is not decidable and
needs a court, which stays out of scope. What *is* decidable, from data already on
chain, is **equivocation**: the publisher signed that a given name and version is
bytes A, then signed that the same version is bytes B. Both statements are on chain
and they cannot both be true.

That is precisely the rug-pull signature. Ship 1.0.0, collect approvals, quietly
republish 1.0.0 with different bytes, hope the version string carries the trust.

- `versionId = keccak256(abi.encode(name, version))`, committed per pin.
  `abi.encode` rather than concatenation, so ("ab","c") and ("a","bc") cannot collide
  into one version and make two unrelated skills look like a contradiction.
- `slashEquivocation(pinIdA, pinIdB)` is permissionless. Anyone submits the proof and
  takes half the bond; the rest goes to a configured recipient rather than being
  burned, so a later insurance pool needs no migration.
- The **later** claim is the guilty one: the earlier claim is what users approved
  against, so the offence is the contradiction introduced afterwards. Argument order
  does not matter.
- Both pins are revoked. A user cannot be expected to know which of two conflicting
  claims was honest.

Deliberately *not* slashable: shipping a genuinely new version, two publishers sharing
a version string, and identical bytes under one version. If any of those were
offences, no publisher could ship an update.

---

## 22. The invariant campaign found a real bug, after failing twice to find anything

This section is the most useful thing in this document.

**The bug.** `invariant_lockedEqualsSumOfLivePinBonds` failed with
`350000000 != 1475000000` after a `slash`. The sequence: revoke a pin, wait out the
7-day unbonding delay, reclaim its bond, *then* prove equivocation. `slashEquivocation`
released the same locked bond a second time and corrupted `lockedBond`, which would
let the publisher over-publish against collateral that no longer existed.

Worse than the accounting error was what it revealed: **revoke-and-run worked.**
Equivocation stays provable from immutable data forever, so a publisher could always
outwait the delay and become unslashable.

**The fix.** `versionPinCount[publisher][versionId]` is tracked on publish, and
`reclaimBond` refuses while a version has more than one claim. Collateral is frozen
for as long as the contradiction is provable — which is permanently, because the
evidence is permanent. The freeze is scoped to the offending version so unrelated
releases are not held hostage. Six unit tests in `EquivocationFreezeTest` cover it,
including the full attack path 365 days later.

**Two failures before that, both of which reported six green invariants.**

First, `RegistryHandler` inherited from `Test`, which brings dozens of inherited public
helpers. The fuzzer treats every one as a candidate, so all 4096 calls went to
inherited no-ops. Second, after restricting selectors, handler functions still called
`vm.prank` internally — but the invariant fuzzer already pranks each handler call to
randomise `msg.sender`, and a nested prank fails. Foundry discards those as
*rejections*, not reverts, so the campaign reported `reverts: 0`, zero published pins,
and six passing invariants.

**Both were caught only because `afterInvariant` asserted the handler had done
something.** Without that assertion this suite would have shipped as green coverage
that checked nothing, twice, for two unrelated reasons. If you write invariant tests,
write the coverage assertion first.

A caveat learned in the process: `afterInvariant` observes state *after* Foundry
reverts the campaign's sequences, so accumulated counters read zero there even on a
healthy run. The authoritative coverage evidence is Foundry's call summary under
`-vv`. The current run reports deposit 614, publish 567, revoke 586, reclaim 592
(10 reverts, the new freeze guard firing), slash 583, withdraw 596.

---

## 23. LockstepLens: the curated client set ERC-8004 asks for

ERC-8004's `getSummary` requires a non-empty `clientAddresses` array, and the spec is
explicit about why: unfiltered aggregation is Sybil-vulnerable, and its Security
Considerations expect third parties to build systems that score the reviewers. **The
standard demands a curated client set and does not supply one.**

`LockstepLens` supplies it, as a pure reader — no forking, no redeployment, no
extension of any registry.

Eligibility: a candidate counts only if it currently approves at least one *live* pin
from that publisher. That is checkable on chain and means something concrete — the
reviewer had that publisher's exact code authorised against its own funds. Rating a
publisher you never trusted with money costs nothing and says nothing.

The demo number: three Sybils rate a publisher 100 and two real users rate it 40 and
30. Naive aggregation returns **74**. The filtered score returns **35**. Same
registry, same `getSummary` call. Adding fifty more Sybils moves the filtered score by
zero.

`unfilteredScore` exists purely so a UI can show both figures side by side. Seeing the
number an attacker can move next to the one they cannot is a better argument than any
explanation.

**Stated limitation.** True exposure weighting — weighting a reviewer by value
actually put at risk with this publisher — needs a per-(account, pin) execution record.
Writing one would put a cross-contract SSTORE in the guard's hot path, charging every
user on every transaction to improve a view. Deferred deliberately, and `weightedScore`
returns an unweighted summary over the eligible set. Do not call it exposure-weighted.

**Registry addresses are constructor parameters, not constants.** They are
CREATE2-deterministic and byte-identical across mainnets, and Validation is still
testnet-only, but a single third-party source is not enough to hardcode an address into
a contract that gates money. Verify on the explorer for your chain and pass them in.

---

## 24. Publishing safety rails, in both the CLI and CI

Slashing created a new way for an honest publisher to hurt themselves: change code
without bumping the version, publish, and become provably equivocating against their
own bond. The overwhelmingly likely cause is a forgotten version bump, so both
publishing paths **refuse** rather than confirm:

- `lockstep publish` checks `versionPinCount` and stops with an explanation.
- The GitHub Action does the same, and additionally fails the job when the manifest
  declares more capabilities than the previous pin — a widened blast radius becomes a
  red check instead of a silent release.
- Identical bytes already pinned is reported as a no-op, not an error.

The Action exists because publishing belongs in CI: the executable bit is not
representable on Windows filesystems, so a skill with an executable script hashes
differently there, and Linux CI is the only place a pin is reliably reproducible.

---

## 25. Design notes on the remaining pieces

**Watcher.** Pure detection separated from RPC and signing, so `findEquivocations` is
testable without a node. Filters already-slashed and already-reclaimed pins to avoid
burning gas on transactions that would revert, orders proofs by bond descending
because in a race the reward goes to whoever lands first, and simulates before sending
so losing a race costs an `eth_call`. `isProfitable` exists so permissionless
enforcement does not become a slow donation.

Blocked attempts are read from **reverted-transaction traces**, not logs, because a log
written before a revert is rolled back. The trace path fails soft: losing the reporting
feed must not take the slashing loop down with it.

**Sandbox.** A manifest that is tedious to write gets written too wide "to be safe",
which is exactly what the bond pricing punishes — so the tightest manifest must be the
easiest to produce. Draft generation records observed calls and emits a manifest
covering only those. Reverted calls are **included**: a skill that tried to call
`approve` and failed still intends to, and omitting it produces a manifest that breaks
the first time the call succeeds. Output is explicitly a draft; observation cannot
prove a skill will never need more.

**Indexer.** The schema deliberately has no `BlockedAttempt` entity, because that feed
cannot exist in logs. Guard events have no fixed address — under EIP-7702 the guard's
code runs at each account's own address — so `event.srcAddress` is the account and the
only way to attribute an approval.

**Badge.** SVG, no runtime, no network call. A badge that beaconed on every page view
would be indefensible in a supply-chain security product. State is carried in text as
well as colour, because colour alone is not a signal a colour-blind reviewer can use,
and a bonded skill that declares allowance-granting power renders amber with the words
"high risk" rather than a plain green tick.

**Allowlist comparison.** `AllowlistWallet` is a fair rendering of a shipped, genuinely
useful control: target allowlist, selector allowlist, value ceiling. It permits the
hostile call and is right to by its own rules — the recipient is inside the calldata,
and an allowlist checks the selector, not the argument. One test runs the identical
calldata through both layers: the spend layer permits, the provenance layer refuses.
Two further tests show Lockstep still enforces the value ceiling and still lets the
approved version through, because a control that blocks legitimate use gets switched
off.

---

## 26. Still unverified

1. **Live OpenClaw Gateway dispatch.** Unchanged, and still the gate. Needs an LLM
   credential and a Gateway install.
2. **`after_tool_call` param shape for `read`.** Handler accepts `params.path` or
   `params.file_path`; if neither matches, provenance never establishes and every call
   blocks — loud and safe, but broken.
3. **ERC-8004 addresses on chain 143.** Deterministic per third-party sources; not
   verified on an explorer.
4. **Monad testnet gas.** All figures are local EVM.
5. **Indexer never run.** `config.yaml` and handlers are written against the HyperIndex
   contract but `envio codegen` has not been executed, so `generated` imports are
   unresolved. Treat the handlers as reviewed-not-run.
6. **Action never run in a real workflow.** It bundles and typechecks; it has not
   executed on a GitHub runner.
7. **Publisher outreach.** Still unstarted, still the thing that decides whether this
   is a company or a prototype.

---

# Session 5 findings — the kill gate, mostly cleared

Installed `openclaw@2026.8.2` into an isolated `.scratch/probe` and loaded the plugin
into a real Gateway runtime. **277 tests.** Everything below was read out of the shipped
package or observed from the loader, not inferred.

---

## 27. The `read` tool's parameter is `path`. `file_path` never existed.

This was unverified item #2 across three sessions, and the plugin carried a
`params.file_path` fallback on the strength of a guess.

Verified from `dist/sessions-CQip-Rlp.js`. The read tool's input schema is:

```
Type.Object({
  path:     Type.String({ description: "File path; relative/absolute." }),
  offset:   Type.Optional(Type.Integer({ minimum: 1, ... })),
  limit:    Type.Optional(Type.Number({ description: "Max lines." })),
  cursor:   Type.Optional(Type.Integer({ minimum: 0, ... })),
  optional: Type.Optional(Type.Literal(true, ...)),
})
```

Bound to `{ name: "read", label: "read", description: "Read text/image file
(jpg/png/gif/webp/bmp); images attach to model context. ..." }` in the same file.

`file_path` appeared in the bundle only as part of `ENV_FILE_PATH_RE`, a regex for
detecting `.env` files. My grep matched it case-insensitively and I read a false
positive as corroboration.

**Fix.** The fallback is removed, and a missing `path` now logs a warning naming the
keys that did arrive. If a future release renames the field, provenance stops
establishing and every guarded transaction is refused — safe, but baffling without a
log line pointing at the cause.

`read` is also confirmed as a canonical tool id in
`dist/core-tool-factory-descriptors-DVnZG0uk.js`, so `matcher: ["read"]` is valid.

---

## 28. Four registration defects the loader found in about ten minutes

Loading the plugin produced exact diagnostics for each. None of these would have been
found by reading documentation.

**1. `plugin export missing register/activate`.** The plugin exported a named
`registerLockstep` function. The host requires a **default** export. Fixed with a thin
`src/plugin.ts` that wraps the tested core.

`definePluginEntry` turned out to be a shape normaliser returning
`{ id, name, description, configSchema (lazy getter), register }`. Worth knowing:
`configSchema` at that layer is **not** a JSON Schema. It is a function returning
`{ safeParse, jsonSchema }`, so it has to be built with
`buildJsonPluginConfigSchema(schema)` rather than written as an object literal. I was
about to hand-roll it and would have guessed the contract wrong.

**2. `trusted tool policy registration requires id, description, and evaluate()`.**
The plugin passed `{ id, matcher, handler }`. Read from
`dist/loader-DhyKX__3.js`, the real contract is:

```
registerTrustedToolPolicy({ id, description, evaluate, matcher? })
```

The callback is `evaluate`, not `handler`, and `description` is mandatory. The loader
additionally requires the id to appear in `contracts.trustedToolPolicies` **and** the
plugin to be explicitly enabled — `record.enabled && record.explicitlyEnabled === true`.
A test now asserts the exact shape and that `handler` is absent, so a refactor cannot
quietly restore it.

**3. `plugin must declare contracts.tools before registering agent tools`.**
`api.registerTool` is manifest-gated the same way. `contracts.tools:
["lockstep_send"]` added.

**4. `typed hook "agent_end" blocked because non-bundled plugins must set
plugins.entries.lockstep.hooks.allowConversationAccess=true`.** This one matters
operationally: `agent_end` is what releases per-run provenance. Without it the tracker
grows one entry per run for the lifetime of the Gateway, and finished runs stay
attributable. **That config flag is not optional for correct operation** and belongs in
any install instructions.

There was also no `openclaw.plugin.json` at all. A `package.json` with an
`openclaw.extensions` field is not sufficient; `id` and `configSchema` are required
manifest fields.

---

## 29. Final loader state

```
status: loaded          enabled: true        explicitlyEnabled: true
diagnostics: []         typedHooks: after_tool_call, agent_end
tools: lockstep_send    policy.allowConversationAccess: true
acceptedSurface.contracts:
  tools: lockstep_send
  trustedToolPolicies: lockstep-exec-gate
```

Zero errors, zero warnings. The registered `evaluate` callback was also exercised
directly in tests: `cast send 0xabc` blocks with a reason naming `lockstep_send`, and
`cast block-number` passes through.

**One deployment consequence worth knowing.** The host records an
`acceptedSurfaceHash`. Adding a tool, or a trusted policy, changes the surface and
requires the operator to consent again with `--accept-capabilities`. A release that
widens the plugin's capability surface will therefore appear to "stop working" until
someone re-consents. That is the host behaving correctly, and it should be in the
install notes rather than discovered in production.

---

## 30. Dependency decision

`openclaw` is a **peer** dependency, declared optional. The two SDK helpers the entry
needs are declared in `plugin/src/openclaw-sdk.d.ts` as an ambient module, with the
signatures read from the shipped bundle and the source files cited.

The alternative was pulling 331 packages into this repository to obtain two functions,
and it would have coupled the tested core to the host. The loader confirms the plugin's
own dependencies resolve correctly (`requiredInstalled: true`) with `openclaw` absent
from its own `node_modules`.

---

## 31. What the kill gate still needs

The integration half is now proven: the plugin loads in a real Gateway, its hooks bind,
its tool registers, and its trusted policy is in the accepted surface.

**What remains is one step: a live dispatch.** An actual model reading a `SKILL.md`,
calling `lockstep_send`, and the transaction landing or being refused. That needs an
LLM provider credential and nothing else — no more code.

Until that is observed, the honest statement is: *the plugin is correctly registered
against a real host, and the end-to-end path is untested.* Do not describe the gate as
cleared.

Reproduce the probe:

```powershell
mkdir .scratch\probe; cd .scratch\probe
npm install openclaw@2026.8.2
$env:OPENCLAW_STATE_DIR = "$PWD\state"
node node_modules\openclaw\openclaw.mjs plugins install --link ..\..\plugin --force --accept-capabilities
# set plugins.entries.lockstep.enabled, .config, and .hooks.allowConversationAccess in state\openclaw.json
$env:LOCKSTEP_EXECUTOR_KEY = "<throwaway key, must differ from the account key>"
node node_modules\openclaw\openclaw.mjs plugins enable lockstep --accept-capabilities
node node_modules\openclaw\openclaw.mjs plugins inspect lockstep --runtime --json
```

---

# Session 6 findings

Closed the two largest untested surfaces and prepared the last step of the kill gate.
**302 tests: 100 Solidity, 174 unit, 28 end-to-end.**

---

## 32. ChainAdapter had zero tests, and it is the code that moves money

Twelve tests now exercise it against a live Anvil chain. Mocking would have proved
nothing: the parts that can go wrong are log-replay ordering, revocation handling, and
whether `simulateContract` surfaces a policy rejection as a readable error. All three
need a chain.

What is now covered:

- construction **refuses** when the executor key equals the account key — the design
  invariant the whole threat model rests on
- `findApprovedPin` returns the honest pin, and `undefined` for a published-but-unapproved
  version, which is the rug pull at the lookup layer
- negative lookups are cached, so a rug-pulled skill does not replay every log
- `submit` lands a real transaction and the venue's counter moves
- a mismatched attestation and an undeclared capability both surface as readable errors
  **without sending a transaction** — the reason `submit` simulates first
- unapproval, re-approval, and publisher revocation are all picked up from log replay

**A design fix fell out of this.** `ChainAdapter` selected its chain from `chainId` with
no override, so it could only ever run against a real Monad endpoint — meaning the code
that submits transactions was structurally untestable. Added `chainOverride`, used only
by tests. Untestable-by-construction is a defect, not a constraint.

---

## 33. The Action's safety rails are now verified, and `process.exit` was the obstacle

Thirteen tests run `main()` directly against a live chain with the runner environment
simulated: `INPUT_*` variables, `GITHUB_OUTPUT`, and `GITHUB_STEP_SUMMARY` pointed at
temp files, with the heredoc output format parsed back.

The two refusals that are the action's whole value are now proven, not asserted:

- **Refuses a second conflicting claim about one version.** Publish `1.0.0`, change the
  body, publish `1.0.0` again — blocked with "provable equivocation". Without this the
  action would help an honest publisher lose their own bond to a forgotten version bump.
- **Fails the job when capability widens.** Also proven that
  `fail-on-capability-change: false` allows it, so the escape hatch works.

Also covered: dry-run needs no key, high-risk capabilities appear in the job summary
with a reason, a wider manifest prices higher, an unchanged republish is a no-op rather
than an error, and the three input validations reject.

**`process.exit` had to go first.** `fail()` called it directly, so any test asserting a
refusal would have taken the test process down. It now throws `ActionFailure` and
`entry.ts` does the exiting. A module that calls `process.exit` cannot be tested, and
that is reason enough not to.

---

## 34. Envio codegen cannot run on Windows

`envio@3.9.0` ships native binaries for `linux-x64`, `linux-x64-musl`, `linux-arm64`,
`darwin-x64`, and `darwin-arm64`. **There is no Windows build**, and `envio codegen`
fails with `Cannot read properties of null (reading 'runCli')` because the platform
package is absent.

This is a platform limitation, not a defect in the config. The response is to verify it
where it can run: CI now has a dedicated `indexer` job that installs, runs codegen, and
typechecks the handlers against the generated bindings. That job is the only place the
config, schema, and handlers are proven to agree.

`indexer/tsconfig.json` maps the `generated` import with a note explaining it resolves
only after codegen.

Also worth recording: the first attempt pinned `envio@2.31.0`, which does not exist. npm
reported success while quietly removing packages instead of adding any. An install that
"succeeds" without installing the thing is worth checking for, and `npm view envio
version` was the one-line answer.

---

## 35. The live-dispatch harness

`scripts/live-dispatch.mjs` automates everything except the model credential, so the
last step of the kill gate is one command:

```
node scripts/live-dispatch.mjs --provider anthropic --key sk-...
node scripts/live-dispatch.mjs --provider anthropic --key sk-... --rug-pull
```

It starts Anvil as chain 10143, deploys through the shipping
`Deploy.s.sol`, bonds a publisher, pins the demo skill's **real on-disk hash**,
delegates the account via 7702, approves the pin, authorises the agent executor,
installs and enables the plugin in an isolated state directory pointed at the local
chain, copies the skill into the Gateway workspace, and runs one agent turn.

Two design points worth stating:

**It hashes the installed copy, not the repo copy.** The Gateway reads the installed
skill, and only those bytes matter. Hashing the source would test the wrong file.

**`--rug-pull` replaces the skill bytes *after* approval.** That is the actual attack:
approved bytes swapped for different ones. The harness asserts the hostile hash differs
before proceeding, so a broken attack cannot pass as a successful defence.

The verdict is read from chain state — `SkillExecuted` logs on the account — not from the
model's prose. Honest run: the transaction must land. Rug-pull run: it must be refused
with `NOT_PINNED`, and a run where the rug pull *succeeds* exits non-zero, because that
is a failure of the product rather than of the harness.

---

## 36. Remaining, and who can do it

| Item | Blocker |
|---|---|
| ~~Live dispatch~~ | **Done. Both directions pass against Claude on Bedrock. See section 37.** |
| Monad testnet gas + deploy | Testnet MON from the faucet, and a key. |
| ERC-8004 addresses on chain 143 | Explorer check. Deterministic per third-party sources; still not confirmed first-hand. |
| Indexer codegen | Runs in CI on Linux. Cannot run on this machine. |
| Action on a real runner | Workflows are written; needs a push to a GitHub repo. |
| Mainnet deploy, video, submission | Yours. |
| Publisher outreach | Yours, and still the thing that decides whether this is a company or a prototype. |

---

## 37. The kill gate passed, and what it cost to get there

Both directions now pass against a real model — Claude Sonnet 4.5 on Amazon Bedrock,
through a real OpenClaw Gateway, against a local Monad-configured chain.

```
PASS: the approved skill executed. SkillExecuted was emitted.
PASS: the rug pull was refused, and the agent was told why.
```

The rug-pull run is the one that matters. The approved bytes hashed to
`0x9b68b339278fd5f40079090a0a535d6c687aaacbb36d9ef888a942a12c600b80`; after the swap the
bytes on disk hashed to `0x960ea319b251ab8699fb8fa916c6e27e17ddc1938df41065a63c2227229bb4da`.
Provenance still resolved — the skill really was in context — and the guard refused anyway.
The model reported it back as **`Swap failed with error code: NOT_PINNED`**.

Getting there took eleven runs and turned up nine defects. Every one of them was invisible
to 302 passing tests, and most were invisible to the previous run's symptoms too.

### The CLI had never once run

`node cli/src/index.ts --help` failed on its first import. Sources use TypeScript's
`./x.js` specifier convention, which names the file a build would emit, but this repo has no
build: every package points `main`, `exports` and `bin` at `.ts` sources. Vitest resolves
`.js` to `.ts` silently, and so does OpenClaw's loader, so 174 unit tests and 28 e2e tests
passed while the shipped entry point could not start.

Fixed by naming the files that exist: 53 specifiers across 24 files changed to `.ts`, with
`allowImportingTsExtensions` in the base tsconfig. Three constructor parameter properties had
to go too, because Node's type stripping refuses any file needing real codegen.

`e2e/test/entrypoints.test.ts` now runs every entry point declared in every workspace
manifest under plain `node`. It reads the manifests at runtime, so a new package is covered
without anyone remembering.

### `lockstep_send` was malformed and uncallable

The tool was registered with `handler(params, ctx)`. The host requires `execute`, and calls
it as `execute(toolCallId, params, signal, onUpdate)` — so even the argument positions were
wrong. The plugin loaded, `plugins inspect` listed the tool, and the unit tests passed,
because the tests asserted the same wrong shape the code implemented. The host only objected
when it went to bind the tool mid-run: *"lockstep_send missing execute function"*.

A test that agrees with the code proves nothing. The replacement states the host's terms,
taken from its own validator.

### Provenance was recorded into an object nobody read

Three separate causes, each hiding the next.

**`agent --local` never fires plugin hooks.** Embedded mode does not attach typed hooks to
the global hook runner. The plugin loaded, both hooks appeared in `plugins inspect`, the tool
bound and ran — and no hook ever fired, so every skill read went unobserved. The harness now
runs a real Gateway, which is what the install message advises anyway.

**A plugin gets one handler per hook name.** The host keys typed hooks by plugin id and hook
name, so a second `api.on("after_tool_call", ...)` *replaces* the first. A debug hook added
to diagnose the problem silently displaced the handler it was meant to observe. Debug tracing
now lives inside the one handler.

**A tracker per registration.** The host calls `register` several times per Gateway start.
With a tracker created per call, the surviving hook wrote to one map while the bound tool read
another: the trace showed the hook counting up while `lockstep_send` kept reporting
`tracked=0`. The tracker is now process-wide, which is also just correct — provenance is
scoped to a run, not to a registration.

Correlation had to change with it. Hooks receive a `runId`; the tool factory context receives
`sessionId` and `sessionKey` and **no run identifier at all**. A key only one side can compute
is not a key, so both sides correlate on session and the per-turn lifetime is preserved by
clearing on `agent_end`. Two concurrent runs in one session land in the same bucket, which
reads as ambiguous, which blocks — a refused transaction, not a borrowed approval.

### Tilde paths silently left the skill root

A live read arrived as `~/AppData/Local/Temp/.../skills/kuru-quote/SKILL.md`. Node's `resolve`
gives `~` no meaning, so it became a literal `~` directory under the working directory: still
ending in SKILL.md, still looking like a manifest, but under no configured root. A genuine read
was rejected and the rejection was indistinguishable from a policy decision.

### The model cannot be asked to hash a function signature

Given only a quote, Claude assembled the calldata itself and reached for `sha3-256` and
Node's `createHash` instead of keccak256. The selector was wrong, the guard refused it as an
undeclared capability, and the refusal was correct for an uninteresting reason. The demo skill
now emits `target`, `data` and `value` directly, which is what a real skill does; the value is
verifiable with `cast calldata "swap(uint256)" 100`.

### Bedrock needs more than credentials

Three separate walls, none of them documented together:

- **The bare model id does not work.** Current Claude models on Bedrock are reachable only
  through a cross-region inference profile, so `us.anthropic.claude-sonnet-4-5-...`, not
  `anthropic.claude-sonnet-4-5-...`. The bare id fails with `ValidationException`. The harness
  now refuses a bare id up front rather than discovering it a minute in.
- **OpenClaw's catalog has no Bedrock models.** `models refresh` pulls 41 providers and 268
  models, none of them Bedrock, and an unlisted id fails as `Unknown model` however valid it
  is on AWS. The model has to be declared under `models.providers`.
- **The transport is not built in.** `bedrock-converse-stream` appears throughout OpenClaw's
  message-handling tables but no provider implements it; that lives in
  `@openclaw/amazon-bedrock-provider`. Without it a correctly configured model fails with
  *"No API provider registered for api: bedrock-converse-stream"*.

Also: `--hardfork prague` conflicts with `--chain-id 10143`, because this Foundry build knows
10143 as Monad and applies Monad's network config, which already enables 7702. And the chain
id has to match: the plugin signs for 10143, so a node answering as 31337 rejects everything.

### Swallowed diagnostics cost more than the bugs

Four separate places discarded the information needed to understand a failure, and each one
turned a five-minute fix into a fifteen-minute run followed by a guess.

- `process.exit()` straight after `process.stdout.write` truncates piped output, which lost
  the harness's PASS/FAIL verdict. Now written synchronously to the file descriptor.
- A `.catch()` that reported "run `npm install`" for every possible import failure, when the
  real error was an unresolvable specifier.
- Two e2e suites piped `forge`'s stderr and never drained it, so the reason was thrown away —
  and an unread pipe can stall forge outright once the OS buffer fills.
- The agent turn's `error` and `status` were ignored, so a harness timeout was reported as
  "the approved skill did not execute", blaming the guard for the harness.

`LOCKSTEP_DEBUG` exists because of this. Every refusal reads identically from the agent's
side; only a trace distinguishes "the hook never ran" from "the read was not a manifest" from
"provenance was filed under another id".

### Two bugs found in the e2e suite itself

All four e2e suites ran `forge script --broadcast` against chain 31337, so all of them wrote
`contracts/broadcast/Deploy.s.sol/31337/run-latest.json`. On Windows that lock is exclusive
and the loser failed with `os error 32`. Distinct ports were not enough isolation. `e2e` now
sets `fileParallelism: false`, which also stops chain tests failing on timeouts caused by each
other's CPU load.

And the new entry-point suite used `spawnSync`, which holds the worker thread for the seconds
each type-stripping node start takes, starving vitest's RPC and ending the run with
`Timeout calling "onTaskUpdate"`. Async spawn fixed it and cut the file from 83s to 33s.

### Live credentials landed in a tracked file

`.env.example` is the one env file `.gitignore` deliberately does **not** ignore, and a real
AWS key pair was pasted into it. Moved to `.env.local`, template blanked, and confirmed
against `git add --dry-run` rather than `git check-ignore` — the latter exits 0 for a negated
pattern and reads like the file is ignored when it is not. The repo had no commits, so nothing
entered history. The loader now also treats an empty value as unset, so an unfilled template
stops with "no AWS credentials found" instead of failing deep inside the AWS SDK.

## 38. A first-principles security pass found four exploitable defects

Recorded in full because the alternative — a changelog entry saying "hardening" — is exactly
the behaviour this project exists to argue against. A registry whose thesis is *verify, do not
trust the label* does not get to describe its own defects vaguely.

The narrative for each, with the attack and the reasoning behind each fix, is in the README
under [What the security pass found](README.md#what-the-security-pass-found). What follows is
the part that belongs in a findings log rather than a product document: what the defects had in
common, and why the existing tests did not catch them.

### The four

| # | Defect | Cost to exploit | Tests that fail without the fix |
|---|---|---|---|
| 1 | `publish` accepted an attacker-chosen `versionId` and never checked it, so equivocation became unprovable and the bond decorative | one `cast send` | 10 new |
| 2 | `LockstepLens` believed any contract that returned `true` from `isPinApproved`, so the Sybil filter did not filter | one contract deployment, cloneable | **7 existing** |
| 3 | The value ceiling was checked per call with nothing bounding batch size, so any amount could be moved by splitting it | zero — just a longer array | 5 |
| 4 | `versionPinCount` was never decremented, so a successful challenge left the *honest* pin's bond frozen forever with no beneficiary | not an attack; ordinary bad luck | 4 + an invariant |

### What they had in common

**Every one was in a mechanism already described as working.** Not gaps, not unfinished work.
The README documented the version commitment, the Sybil filter, the value ceiling and the
unbonding freeze as properties of the system, and three of the four were false as implemented.
That is a worse failure mode than an absent feature, because a documented guarantee invites
people to rely on it.

**Three of the four were free.** No capital, no timing, no privileged position.

**The tests agreed with the code instead of testing it.** This is the transferable lesson and it
recurs in three of the four:

- The version id hole survived because the honest CLI and the honest Action both derived the id
  correctly. Every test exercised the tooling, so every test passed. The attack needs one
  transaction that does not go through the tooling, and nothing in the suite represented that.
- The Sybil filter had thirteen passing tests and did nothing, because **every Sybil in them was
  a bare EOA.** An EOA has no code, the eligibility staticcall fails, the candidate is rejected.
  That looks like the filter working. It proves only that an address which cannot answer is not
  counted, and never asks what happens when one answers and lies.
- The frozen-bond defect was asserted *on purpose*, by a test whose comment read "the innocent
  pin's bond is still frozen: the contradiction stands." The bug was written down as intent, so
  no amount of running the suite could have surfaced it.

A test written from the same mental model as the code inherits the model's blind spot. The only
one of the four that a property-based approach found on its own was the value ceiling, and the
fuzzer produced it immediately once asked the right question: 24 calls of 0.075 MON through a
1 MON ceiling.

### The verification rule adopted as a result

**Every fix was checked by disabling it, running the suite, confirming the new tests fail, and
restoring.** The counts in the table above are that measurement, not an estimate.

This is cheap and it is the only thing that distinguishes a test that constrains behaviour from
a test that describes it. It caught two cases where a first draft of a test passed with and
without the fix:

- A re-delegation test initially pointed the account at a *stricter* implementation, so it
  passed because a different storage slot read empty — nothing to do with the check under test.
  Rewritten to re-delegate to a maximally permissive implementation, so the account still
  answers "yes" and the only thing that changed is which implementation is answering.
- The EIP-3541 test needed a control. `isGuardedAccount` is only sound because contract code
  cannot begin with `0xEF`, and a test that merely shows the deployment failing would pass just
  as happily with malformed initcode. The same initcode is now shown to deploy successfully
  behind a legal `0xEE` prefix first.

### Two load-bearing dependencies that were assumed and are now proved

Both were implicit in code that was already correct. Writing them down means a later change
cannot quietly remove the thing holding it up.

**EIP-3541 is what makes the Lens check sound.** Eligibility compares `EXTCODEHASH` against
`keccak256(0xef0100 || guard)`. That is a complete test only because no contract can ever carry
those bytes: EIP-3541 rejects any creation whose returned code starts with `0xEF`. Without that
rule an attacker deploys the designator directly and forges unlimited reviewers without ever
holding a key. Proved by attempting exactly that deployment.

Incidental, and worth knowing before someone copies the technique: a creation rejected by
EIP-3541 halts exceptionally and consumes **every unit of gas forwarded to it**. Uncapped, that
one test billed over a billion gas. `CREATE` failing does not revert its caller, so a `{gas: …}`
cap on the surrounding call bounds the waste without changing what is measured.

**Checked arithmetic is load-bearing in the guard's batch total.** Summing call values in an
`unchecked` block would let an attacker choose values summing to a small number modulo 2^256 —
`type(uint256).max` and `2` sum to 1 — so the total sits under the ceiling while each call moves
a fortune. Verified by removing the check: the budget passed and only the account's balance
stopped the batch. A comment now records this at the loop, because it looks like an obvious
optimisation.

### One honesty correction that was not a defect

The effective penalty for equivocation is **half the bond, not the bond.** Challenging is
permissionless, so the offender is also a potential challenger and can collect
`challengerRewardBps` of their own forfeited bond from an unrelated address.

Deliberately not "fixed" with a `msg.sender != publisher` check. A fresh EOA defeats that in one
transaction, and a check that looks like a protection but is not is worse than no check, because
it invites people to price the risk wrong. The alternatives are worse still: a privileged
challenger set reintroduces a committee, and dropping the reward removes the only funding a
watcher has. So the figure is stated instead, and a test pins it.

The same permissionlessness is what gives an honest publisher a way out of defect 4.
