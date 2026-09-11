# Redeploy runbook

Aligns the live Monad testnet deployment with the audited source, and fixes three things the
current deployment gets wrong regardless of security.

**Simulated cost: 5,690,414 gas ≈ 1.1552 MON** at 203 gwei max fee. The account holds 4.0252 MON.
The whole sequence is ~17 transactions; the deploy dominates and the rest are small.

Everything below was verified against the live chain and this toolchain (`cast 1.8.1`) rather than
recalled. Where a step has a trap, the trap is stated before the command.

---

## Why this is not optional

| Reason | Detail |
|---|---|
| **The live guard is exploitable** | It has no self-target check, so an authorised executor can reach `authorizeExecutor`/`approvePin` through `execute`. Not reachable via the *currently approved* pin — checked, see below — but the code is vulnerable |
| **The live pricing is inverted** | `authorizeExecutor`/`approvePin` are not high-risk selectors on the live registry, so a policy rewrite costs 125 AUSD against 625 for a token approve |
| **Four executors hold standing spend rights** | All four still authorised, none revoked, over a 5,201 mAUSD balance |
| **The publisher is the account** | `pin.publisher == 0x209C90…aFF2 == ACCOUNT`. One address publishes, bonds and approves, so no adversarial relationship is demonstrated |
| **`SkillExecuted` could not be found** | Zero in blocks 59428800–59432400, while the README claims a verified live execution. A fresh run produces a receipt that can actually be cited |

---

## THE TRAP THAT IS WORSE THAN THE KNOWN ONE

Everyone remembers to re-sign the delegation. **Almost nobody remembers that storage survives it.**

`GUARD_STORAGE_SLOT` is `keccak256(abi.encode(uint256(keccak256("lockstep.guard.v1")) - 1)) & ~0xff`
— derived from the *namespace string*, not from the guard's address. The deploy simulation confirms
the new guard reports the identical slot:

```
guardStorageSlot  0x723bc0536d6998736ca58b10278e77528d6552c6336394144a42647181e0f200
```

EIP-7702 replaces an account's **code**, not its **storage**. So the moment you re-delegate to the
new guard, it reads the same slot at the same account and finds everything the old guard wrote:

- **the four old executors are still authorised**, and the new guard will honour them
- **the old pin still reads as approved**

`contracts/test/GatorComparison.t.sol:test_theApprovalSurvivesInStorageWhileUnenforced` proves
exactly this, and `LockstepGuard.guardStorageSlot`'s own doc comment warns about it.

The old *pin* is inert — the new guard's `registry` immutable points at the new registry, which has
never heard of that pin id, so `verify` returns a zero hash and `execute` reverts with
`SkillHashMismatch`. **The four executors are not inert.** They become live authority on the new
guard against any pin you subsequently approve.

**So step 7 must explicitly revoke them.** A fresh deployment does not give you a fresh account.

---

## Preconditions

- `ACCOUNT_PRIVATE_KEY` in `.env.local`, deriving `0x209C903f68f169C8e654e0C3C91cAdc4C4A4aFF2`
- 4.0252 MON on that account (confirmed)
- `.tools/foundry` on `PATH` — `forge` is not on the default path on this machine
- Contracts green: `cd contracts && forge test` → 14 suites, 187 tests

---

## 1. Generate the two separated identities

The narrative fix. Publisher, account and executor must be three different addresses, or the
economic story is one party bonding against itself.

```powershell
# Publisher: publishes the pin and posts the bond.
node -e "const{generatePrivateKey,privateKeyToAccount}=require('viem/accounts');const k=generatePrivateKey();console.log('PUBLISHER_PRIVATE_KEY='+k);console.log('address',privateKeyToAccount(k).address)"

# Executor: the agent's key. Holds no funds beyond gas.
node -e "const{generatePrivateKey,privateKeyToAccount}=require('viem/accounts');const k=generatePrivateKey();console.log('LOCKSTEP_EXECUTOR_KEY='+k);console.log('address',privateKeyToAccount(k).address)"
```

Paste both keys into `.env.local` (gitignored). Record only the **addresses** anywhere else.

Keys are generated locally and never leave the machine, which is the same property `.env.example`
already claims for the account key.

## 2. Deploy

```powershell
.scratch\redeploy-broadcast.cmd
```

That wrapper is `.scratch\sim-deploy.cmd` plus `--broadcast --private-key %ACCOUNT_PRIVATE_KEY%`.
It sets `ERC8004_IDENTITY`, `ERC8004_REPUTATION` and `SLASH_RECIPIENT`.

Consider pointing `SLASH_RECIPIENT` at an address that is not the account. `PinRegistry` says the
non-challenger share should eventually reach an insurance pool, and having it land somewhere other
than the deployer makes the slashing demo read correctly.

**Record from the output:** `PinRegistry`, `LockstepGuard`, `LockstepLens`, `bondAsset`, and the
block number of the registry's creation transaction (that becomes `indexer start_block`).

## 3. Fund the publisher and the executor

```powershell
cast send <PUBLISHER> --value 0.3ether --private-key %ACCOUNT_PRIVATE_KEY% --rpc-url https://testnet-rpc.monad.xyz
cast send <EXECUTOR>  --value 0.2ether --private-key %ACCOUNT_PRIVATE_KEY% --rpc-url https://testnet-rpc.monad.xyz
```

## 4. Mint bond collateral to the publisher

`MockBondAsset.mint` is unrestricted on a test chain, so this is free and anyone can call it.

```powershell
cast send <NEW_BOND_ASSET> "mint(address,uint256)" <PUBLISHER> 5000000000 --private-key %ACCOUNT_PRIVATE_KEY% --rpc-url https://testnet-rpc.monad.xyz
```

5000000000 is 5,000 mAUSD at 6 decimals — comfortably above the 1,150 the demo pin needs.

## 5. Point the demo skill at a real target, and bump the version

Currently `demo/skills/kuru-quote/lockstep.json` declares targets `0x…0001` and `0x…0002`, which
are placeholders. The existing live pin does better than the repo's own fixture: it declares
`transfer` and `approve` on the real mock bond asset, which is why the current demo can show an
observable balance change.

Edit the manifest to declare `(NEW_BOND_ASSET, transfer(address,uint256))` and
`(NEW_BOND_ASSET, approve(address,uint256))`, and **bump the version to `3.0.0`**.

The bump is not cosmetic. Republishing a different byte set under a version already on chain is
equivocation, and the Action refuses to help commit it. A new version is a new release.

Bond for that shape: `100 + 2×25 + 2×500 = 1,150` mAUSD, and `maxValuePerBatch` stays `0`.

## 6. Publish, as the publisher

```powershell
node cli/src/index.ts publish demo/skills/kuru-quote --manifest demo/skills/kuru-quote/lockstep.json
```

with `PUBLISHER_PRIVATE_KEY` and the new `PIN_REGISTRY` in the environment. Use `--dry-run` first to
see the hash and the quoted bond before spending.

**Record:** the `skillHash`, the `pinId`, and the transaction hash.

## 7. Re-sign the EIP-7702 delegation to the NEW guard

**`--self-broadcast` is mandatory here and its absence fails silently.** The account is signing an
authorization that the account itself will broadcast, so the nonce must be current + 1. Without the
flag `cast` signs against the current nonce, the transaction succeeds, and the delegation never
takes effect — a demo that looks perfect and enforces nothing.

```powershell
$auth = cast wallet sign-auth <NEW_GUARD> --private-key $env:ACCOUNT_PRIVATE_KEY --rpc-url https://testnet-rpc.monad.xyz --self-broadcast
cast send $env:ACCOUNT_ADDRESS --auth $auth --private-key $env:ACCOUNT_PRIVATE_KEY --rpc-url https://testnet-rpc.monad.xyz
```

**Verification gate — do not continue until this passes:**

```powershell
cast code <ACCOUNT> --rpc-url https://testnet-rpc.monad.xyz
# must be exactly 0xef0100 || <NEW_GUARD>, lowercased
```

## 8. Clean up the storage that survived, then set the new policy

Read the trap section above before running these. The first five commands undo state the old guard
wrote, which the new guard would otherwise honour.

```powershell
# Revoke all four carried-over executors.
cast send <ACCOUNT> "revokeExecutor(address)" 0x8b8CAC37F8954Dd7154198283D77D35F9CdE54D6 --private-key %ACCOUNT_PRIVATE_KEY% --rpc-url https://testnet-rpc.monad.xyz
cast send <ACCOUNT> "revokeExecutor(address)" 0x9271A2C925feA774157c1248fd46580eE8bfea2d --private-key %ACCOUNT_PRIVATE_KEY% --rpc-url https://testnet-rpc.monad.xyz
cast send <ACCOUNT> "revokeExecutor(address)" 0x769b15B7312504E8102BE080166fcA2a787D9a4f --private-key %ACCOUNT_PRIVATE_KEY% --rpc-url https://testnet-rpc.monad.xyz
cast send <ACCOUNT> "revokeExecutor(address)" 0x85800d32af91eA711755D22267E42282648b6dE8 --private-key %ACCOUNT_PRIVATE_KEY% --rpc-url https://testnet-rpc.monad.xyz

# Unapprove the stale pin. Inert against the new registry, but it reads as approved.
cast send <ACCOUNT> "unapprovePin(bytes32)" 0x0573e8dd6c49cffb9c00dbf3eb224b0ee1abab6bae817b95f07d9a1273736401 --private-key %ACCOUNT_PRIVATE_KEY% --rpc-url https://testnet-rpc.monad.xyz

# Authorise exactly ONE executor.
cast send <ACCOUNT> "authorizeExecutor(address)" <EXECUTOR> --private-key %ACCOUNT_PRIVATE_KEY% --rpc-url https://testnet-rpc.monad.xyz
```

Then approve the new pin through the CLI rather than `cast`, because the CLI shows the capability
diff and now prompts on every hash change:

```powershell
node cli/src/index.ts approve demo/skills/kuru-quote
```

**Verification gate:**

```powershell
cast call <ACCOUNT> "isPinApproved(bytes32)(bool)" <NEW_PIN_ID>              # true
cast call <ACCOUNT> "isExecutorAuthorized(address)(bool)" <EXECUTOR>         # true
cast call <ACCOUNT> "isExecutorAuthorized(address)(bool)" 0x8b8CAC37…        # false
```

## 9. Produce one real execution, and keep the receipt

This is what replaces the claim that could not be substantiated.

```powershell
node scripts/live-dispatch.mjs --provider bedrock --model amazon-bedrock/us.anthropic.claude-sonnet-4-5-20250929-v1:0
```

Then the refusal, which is the demo's actual payload:

```powershell
node scripts/live-dispatch.mjs --provider bedrock --model amazon-bedrock/us.anthropic.claude-sonnet-4-5-20250929-v1:0 --rug-pull
```

**Record:** the `SkillExecuted` transaction hash and block, the mAUSD balance before and after, and
for the refusal, whether it was blocked at the plugin (`NOT_PINNED`, no transaction) or on chain
(`SkillHashMismatch`, a reverted transaction). Those are different layers and the video must label
them separately.

If you also want an on-chain `SkillHashMismatch` receipt, submit a mismatched attestation directly
as the executor. Do not present a plugin refusal as though it produced a transaction.

## 10. Rotate every address

```powershell
# Phase A - what the deploy produced.
node scripts/rotate-deployment.mjs --dry-run `
  --registry <NEW_REGISTRY> --guard <NEW_GUARD> --lens <NEW_LENS> `
  --bond-asset <NEW_BOND_ASSET> --deploy-block <BLOCK> --indexer-start-block <BLOCK>

# Inspect, then re-run with --write.

# Phase B - what the publish and the run produced.
node scripts/rotate-deployment.mjs --write --pin-id <NEW_PIN_ID> --skill-hash <NEW_SKILL_HASH>
```

The script covers **85 occurrences across 18 tracked files**, derives the 7702 designator from the
guard address so the two cannot disagree, replaces the full designator before its truncated form,
and **rescans afterwards and fails if any old value survives**. Doing this by hand is how
`indexer/config.yaml` keeps a stale guard and silently indexes nothing.

Add `PUBLISHER_ADDRESS` to `.env.example` and the README. It has no entry today because the
publisher and the account were the same address.

## 11. Verify everything

```powershell
npm run build --workspace @lockstep/action   # dist/ is a committed artifact and embeds nothing, but rebuild anyway
cd contracts; forge test; forge snapshot; cd ..
npm run test:unit
npm run typecheck
npm run test:e2e
npm run verify:dashboard                     # the check-export Lens tripwire lives here
```

Then confirm the deployed reality matches the committed values:

```powershell
node .scratch/livepin.mjs        # update the constants at the top first
node .scratch/liveapprovals.mjs
```

## 12. Update the honesty sections

These currently say the deployment predates the security pass. After this, they should not.

- `README.md` — "Live on Monad testnet", "What the security pass found", both gas tables
- `SUBMISSION.md` — "What is not done", the evidence table
- `MASTER_AI_CONTEXT.md` — §19 addresses, §23 known problems 1 and 2
- `HANDOVER.md` — task 4 becomes done
- `.github/workflows/pin-skill.yml` — restore the `pull_request` and `push` triggers, since both
  stated reasons for disabling them are resolved by this deployment

**The bond asset is still a freely mintable mock.** A redeploy does not change that, and
`SUBMISSION.md` must keep saying so.

---

## Cost summary

| Step | Approximate |
|---|---|
| Deploy (4 contracts) | 1.1552 MON |
| Funding two addresses | 0.5 MON |
| Mint, approve, deposit, publish | ~0.1 MON |
| Delegation, 4 revokes, unapprove, authorize, approve | ~0.1 MON |
| One execution | ~0.03 MON |
| **Total** | **~1.9 MON of 4.0252** |

Leaves roughly 2.1 MON, which is enough to do the whole thing twice if the first attempt needs
abandoning.
