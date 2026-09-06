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

**Codegen and handlers verified in CI; not yet running as a hosted deployment.** Envio ships linux
and darwin binaries only, so `envio codegen` cannot run on the Windows machine most of this was
written on — the `indexer` job in `.github/workflows/ci.yml` is where it is actually exercised.

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
| Deployment branch | `main` |

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

Requires Docker and, on Windows, WSL.

```bash
cd indexer
npm ci
npm run codegen     # linux/darwin only
npm run dev         # GraphQL at http://localhost:8080
```

## After the contracts are redeployed

`config.yaml` pins both the registry address and `start_block`, and the current values point at a
deployment that **predates the security pass** described in the root README. When the registry is
redeployed, three things in this directory change together:

- `chains[0].start_block` — the block the new registry was created in
- `chains[0].contracts[0].address` — the new `PinRegistry`
- the `0xef0100 || guard` comment in `config.yaml`, which names the guard the demo account delegates
  to

Then push to the deployment branch, which triggers a full re-index. Nothing in `schema.graphql` or
the handlers needs to change: the `Published` event already carries `versionId`, `name` and
`version`, which is what lets a consumer group pins by version and render a human label instead of a
digest.
