# Lockstep indexer

Envio HyperIndex over `PinRegistry` and the EIP-7702 guard accounts. This is the **read path**; the
chain is the write path, for settlement and dispute only.

## Why this exists, in one number

Monad's public RPC caps `eth_getLogs` at a **100 block range**. At 400ms blocks that is a
forty-second window, so rebuilding this registry's history in a browser costs one request per hundred
blocks and the bill grows by about 1.5 requests a minute, forever. Measured: paging a
ten-thousand-block-old deployment from the dashboard took over two minutes and did not finish.

The dashboard's direct RPC reader still exists, for fresh and local deployments, and it truncates
honestly rather than presenting a partial history as complete. This indexer is what makes the read
path viable on a real chain.

It is also the only way to get some of this data at all. `PinRegistry` stores capabilities in a
nested mapping that cannot be enumerated on chain — the cost of the single-SLOAD check the guard
makes on every call — and ERC-8004's `getSummary` iterates a caller-supplied client array. Both are
correct choices for a hot path, and both mean the readable view has to be reconstructed from events.

## Status

**Hosted on Envio Cloud**, on the free development plan:

```
https://indexer.dev.hyperindex.xyz/0be4884/v1/graphql
```

Deployed on 12 October from `c1be57d`, which has the three fixes described below. It indexes chain
10143 from block 61714758, where the registry was deployed. Read back against the chain the same day,
it was at chain head with all 7 events processed, and every entity matched, including the three
fields the first deployment got wrong.

**Query it with POST.** A plain GET, which is what opening the URL in a browser sends, returns
`PersistedQueryNotSupported`. That means the endpoint is working; it only runs queries sent with POST.

```bash
curl -s https://indexer.dev.hyperindex.xyz/0be4884/v1/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ Pin { id name version requiredBond live } }"}'
```

That returns the one live pin: `0x6520d020…2df4`, `kuru-quote` 3.0.0, `requiredBond` 1150000000
(1,150 mAUSD at 6 decimals), `live: true`. Its two capabilities, the account's approval, the
publisher's bond and the successful execution are indexed too.

**The deployment is temporary.** The free plan deletes a deployment 30 days after it is created,
around 11 November for this one, and seven days with no queries starts deletion sooner. The free plan
also has no fixed production URL. Each push to `envio` creates a new deployment with its own URL and
re-indexes from `start_block`, and an indexer can hold only three deployments at a time.

**Codegen, the typecheck and the handler tests run on Linux only**, in the `indexer` job in
`.github/workflows/ci.yml`. Envio ships linux and darwin binaries, so `envio codegen` cannot run on
the Windows machine most of this was written on.

### Three defects found in the first deployment's data, and fixed

Querying the first deployment and comparing it with the chain showed the pins, approvals and bond
totals right, and three fields wrong. `FINDINGS.md` §41 has the full account.

**`Execution` ids read `undefined-1`.** `Execution` and `Slash` rows are keyed
`<txHash>-<logIndex>`, and HyperIndex only delivers the transaction fields `config.yaml` selects.
This config selected none, so every id was `undefined-<logIndex>`, and two executions in different
blocks that share a log index would have written the same row. `config.yaml` now selects the hash,
and the handlers build these ids through `logId(transactionHash: string, …)`, because Envio types an
unselected field as `FieldNotSelected<…>` and a template literal accepts that silently.

**`Global.totalPublishers` read 0 next to a publisher with a live pin.** The `Published` handler
counted a publisher as new when no `Publisher` row existed. A publisher has to deposit a bond before
publishing, and `BondDeposited` writes that row, so the check never passed. A publisher is now new on
its first pin, `pinCount === 0`.

**Capability selectors were the whole 32-byte topic**, `0x095ea7b3` and 56 zeros, in both the
`selector` field and the id. An indexed `bytes4` is left-aligned in its topic and HyperIndex passes
the topic through. Selectors now keep their first four bytes.

`test/handlers.test.ts` replays the first deployment's seven events, with the values read back from
Monad testnet, through the real handlers using Envio's `createTestIndexer`. Disabling each fix fails
it: the old publisher check fails 2 of the 3 tests, the raw selector 1, and dropping the field
selection fails the typecheck, since a simulated event carries whatever hash it is given.

**After a slash the read model was wrong in three ways:** `livePins` stayed one too high, the slashed pin
had no `revokedAt`, and its bond stayed in `totalBondLocked`. The contract emits `Slashed` and then
`Revoked` for both pins, and the `Revoked` handler returns early for a pin that is no longer live, so the
`Slashed` handler has to do the counting. It now does, without counting a pin out twice when its publisher
had already revoked it. Three tests cover it, with a bystander pin so the live count cannot hide behind its
floor at zero; undoing each of the four changes fails one. **This is committed and not deployed.** The
endpoint above still runs the earlier handlers, and deploying makes a new deployment with a new URL.

## Deploying to Envio Cloud

### Before you start: two things that will bite

**The free plan deletes deployments after 30 days.** That is a hard limit, not a soft one, alongside
soft limits at 100,000 events processed, 5GB of storage, or seven days with no requests. A soft-limit
breach starts a 7-day grace period, then 3 days read-only, then deletion.

The consequence is a scheduling one and it is easy to get wrong: **deploy close to when you need it,
not as early as possible.** A deployment created a month before a demo is a deployment that may not
exist on the day. If it needs to survive longer than 30 days, it needs a paid plan.

**Every push to the deployment branch re-indexes from `start_block`.** Not an incremental update — a
full re-sync, on any change to handlers, `schema.graphql`, `config.yaml`, ABIs or addresses. The
previous deployment keeps serving queries until the new one catches up, so there is no downtime, but
a push is not a cheap operation and the sync is not instant.

### Settings

Configure these in the Envio Cloud dashboard when adding the indexer. The defaults assume a
single-package repository and this is a monorepo, so two of them must be changed:

| Setting | Value |
|---|---|
| Root directory | `indexer` |
| Config file | `config.yaml` |
| Deployment branch | `envio` |

Deploy from a dedicated `envio` branch, not `main`. Every push to the deployment branch creates a new
deployment and re-indexes from scratch, and the free plan allows three deployments per indexer.
Pointing it at `main` would spend one on every docs commit. To deploy, push to that branch:
`git push origin main:envio`.

Multiple indexers per repository are supported precisely by these three fields, which is why the
monorepo layout is not a problem here — unlike the GitHub Marketplace, which requires an action's
metadata at the repository root and therefore cannot list this project's action at all.

### What makes this directory deployable

Three properties, all deliberate. Breaking any of them breaks the hosted build in a way that is
awkward to diagnose from a build log.

**`envio` is a runtime `dependency`, not a `devDependency`.** Envio Cloud requires the version to be
declared in `dependencies` and refuses the deployment otherwise. It was a devDependency, which reads
fine locally — the CLI is a build tool — and would have failed the first hosted deploy.

**This package is not a member of the root npm workspace.** The hosted build installs from the
configured root directory, so this package has to resolve its own tree. A workspace member's
dependencies live in the repository root, where the hosted build does not look.

**`src/EventHandlers.ts` imports nothing outside this directory.** One import, from `envio`. Envio's
monorepo guidance requires this and the reason is the same: nothing above `indexer/` is on the
deployed filesystem.

### Dependency posture, stated plainly

`npm audit --omit=dev` in this directory reports 11 findings (4 low, 1 moderate, 6 high), all
transitive through `envio` itself — `express`, `body-parser`, `cookie`, `qs`, `esbuild`, `viem`.

Two things worth being straight about.

They were always there. Before `envio` moved to `dependencies` they were hidden behind
`--omit=dev`, and moving it did not introduce a single one — it stopped a flag from concealing them.
The indexer genuinely runs an HTTP server at runtime, so counting them as production findings is the
accurate reading.

They are not fixable here. `npm audit fix --force` resolves them by installing `envio@2.32.12`,
which is a major **downgrade** from the pinned 3.9.0. The findings are in Envio's dependency tree and
closing them means Envio updating it.

The root README's "zero production dependency vulnerabilities" claim is scoped to the **browser
bundle** and is unaffected: this package is not a root workspace member, so a root audit never
included it, and none of this code is served to a reader.

## Local development

`npm run dev` requires Docker and, on Windows, WSL. The tests do not need Docker.

```bash
cd indexer
npm ci
npm run codegen     # linux/darwin only
npm run typecheck
npm test            # the handlers, in process, against the live deployment's events
npm run dev         # GraphQL at http://localhost:8080
```

## After the contracts are redeployed

`config.yaml` pins both the registry address and `start_block`. The current values point at the
deployment the root README lists, registry `0xF080…29B0` from block 61714758. When the registry is
redeployed, three things in this directory change together:

- `chains[0].start_block` — the block the new registry was created in
- `chains[0].contracts[0].address` — the new `PinRegistry`
- the `0xef0100 || guard` comment in `config.yaml`, which names the guard the demo account delegates
  to

Then push to the deployment branch (`git push origin main:envio`), which triggers a full re-index
and gives the new deployment a new URL. Nothing in `schema.graphql` or
the handlers needs to change: the `Published` event already carries `versionId`, `name` and
`version`, which is what lets a consumer group pins by version and render a human label instead of a
digest.
