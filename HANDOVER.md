# Handover: what only you can do

Everything that can be done from the repository is done. What is left needs an account you own, a
credential only you can mint, a wallet only you can sign with, or your face and voice.

Submission is **11 October 2026**. Today is **2 September 2026**.

| # | Task | Time | Deadline pressure | Blocks |
|---|------|------|-------------------|--------|
| 1 | [Cloudflare Pages + domain](#1-cloudflare-pages-and-the-domain) | ~20 min | do now | the dashboard link in every doc |
| 2 | [Publisher outreach](#2-publisher-outreach-start-this-first) | 1 hr to start | **start now, 4+ week lead** | three demo claims |
| 3 | [Record the video](#3-record-the-video) | ~3 hrs | after 1 | the submission |
| 4 | [Redeploy the contracts](#4-redeploy-the-contracts--completed) | **DONE** | — | — |
| 5 | [Envio Cloud](#5-envio-cloud-do-this-late-on-purpose) | ~15 min | **wait until October** | an Envio bounty |
| 6 | [Marketplace listing](#6-marketplace-listing-optional) | ~15 min | optional | discovery only |
| 7 | [Submit](#7-submit) | ~30 min | 11 Oct | — |

Task 2 has the longest lead time and the least to do. Start it before task 1.

---

## Current state, so you can trust the rest of this

CI is green on `58b84fe`, which is `main`. 941 tests: 187 contract across 14 suites including 7
invariants, 678 unit, 76 end-to-end against a real chain. The dashboard export gate also passed.

The deploy workflow **fires correctly and fails on one line**, which is the honest state of task 1:

```
✘ [ERROR] In a non-interactive environment, it's necessary to set a
  CLOUDFLARE_API_TOKEN environment variable for wrangler to work.
```

Everything before that step passed on the runner: install, build, header generation, and the export
check. The only missing input is a credential I cannot create for you.

---

## 1. Cloudflare Pages and the domain

Target: `https://lockstep.dofolabs.space`.

### 1a. Find your account ID

```powershell
npx --yes wrangler@4 login
npx --yes wrangler@4 whoami
```

`whoami` prints the account ID. It is also on the right-hand side of any domain's overview page in
the Cloudflare dashboard. It is an identifier, not a secret, but treat it as one anyway.

### 1b. Create the Pages project — production branch matters here

```powershell
npx --yes wrangler@4 pages project create lockstep --production-branch main
```

**The production branch can only be set at creation.** If you omit it, Cloudflare picks a default,
and every deploy the workflow makes will register as a *preview* rather than production. The site
will exist, look right, and the custom domain will not serve it. If that happens, delete the project
and create it again with the flag.

The name must be exactly `lockstep`, because that is what
`.github/workflows/deploy-dashboard.yml` passes to `--project-name`.

### 1c. Mint an API token

Cloudflare dashboard → **My Profile** → **API Tokens** → **Create Token** → **Create Custom Token**.

- Permission: **Account** → **Cloudflare Pages** → **Edit**
- Account resources: include your account only
- No zone permission is needed for deploying. You only need one if you want the token to manage the
  DNS record too, and step 1e does that by hand instead.

Copy it once; Cloudflare will not show it again.

Use a custom token, not the "Edit Cloudflare Workers" template. The template grants far more than
uploading static files, and this token lives in a public repository's secret store.

### 1d. Add the two repository secrets

```powershell
gh secret set CLOUDFLARE_API_TOKEN --repo faizydroid/lockstep
gh secret set CLOUDFLARE_ACCOUNT_ID --repo faizydroid/lockstep
```

Each prompts for the value and does not echo it. Or use the web UI: **Settings** → **Secrets and
variables** → **Actions** → **New repository secret**. The names must match exactly.

Then trigger a deploy without waiting for a push:

```powershell
gh workflow run deploy-dashboard.yml --repo faizydroid/lockstep
gh run watch --repo faizydroid/lockstep
```

`workflow_dispatch` is allowed deliberately, so you can retry this step without pushing a commit.

A successful run prints the deployment URL and the site is live at `https://lockstep.pages.dev`
before any DNS exists. Confirm that URL works before touching the domain — it separates "the upload
failed" from "the DNS is wrong", and those have completely different fixes.

### 1e. Point the domain at it

In the Pages project → **Custom domains** → **Set up a domain** → enter `lockstep.dofolabs.space`.

**If `dofolabs.space` uses Cloudflare nameservers**, accept the prompt and Cloudflare writes the
CNAME itself. Done.

**If it does not**, add this record at your DNS provider:

| Type | Name | Value | Proxy |
|------|------|-------|-------|
| CNAME | `lockstep` | `lockstep.pages.dev` | n/a |

Certificate issuance usually takes a few minutes and can take up to ~15. Until it finishes you may
see a TLS warning; that is normal and not a misconfiguration.

### 1f. Verify the headers actually arrive

This is the step worth not skipping. The whole point of generating `_headers` is that a static host
sends only what it is told, and three of these cannot be expressed in markup.

```powershell
curl.exe -sSI https://lockstep.dofolabs.space | Select-String -Pattern "content-security-policy|x-frame-options|referrer-policy|x-content-type-options|cross-origin-opener-policy|permissions-policy|cache-control"
```

All seven should appear:

| Header | Expected value |
|--------|----------------|
| `content-security-policy` | ends with `frame-ancestors 'none'; upgrade-insecure-requests` |
| `x-frame-options` | `DENY` |
| `referrer-policy` | `no-referrer` |
| `x-content-type-options` | `nosniff` |
| `cross-origin-opener-policy` | `same-origin` |
| `permissions-policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` |
| `cache-control` | `no-store` |

The `frame-ancestors 'none'` part is worth reading specifically. It is the one directive that cannot
exist in the `<meta>` CSP, so its presence proves the `_headers` file took effect rather than the
markup.

Then confirm the other cache rule applies, using any hashed asset path from the page source:

```powershell
curl.exe -sSI https://lockstep.dofolabs.space/_next/static/... | Select-String -Pattern "cache-control"
# expect: public, max-age=31536000, immutable
```

If the security headers are missing, `_headers` did not upload — check the "Build and verify the
dashboard" step in the run log, which prints `wrote .../app/out/_headers` followed by each header
name.

Cloudflare's default is `referrer-policy: strict-origin-when-cross-origin`, which leaks pin ids and
account addresses in the `Referer` on any outbound click. Seeing that value means the file did not
take effect.

---

## 2. Publisher outreach (start this first)

The single highest-leverage hour, and the only task whose cost is measured in weeks of waiting
rather than minutes of work.

Three things in `PLAN.md` and one shot in `VIDEO.md` assume a real third party has pinned a skill.
None of that exists. `SUBMISSION.md` says so plainly, which is the right call, but a real pin from
someone who is not you is worth more than any code you could add in the same time.

**What to do today:** pick 3–5 maintainers of agent skills, MCP servers, or OpenClaw plugins. Send a
short message with: the problem in one sentence, the dashboard link once it is live, and one concrete
ask — add `faizydroid/lockstep/action@v0.1.1` to their release workflow.

The Action is the ask, not the contracts. It is a dozen lines of YAML in a repository they already
control, and it needs no wallet, no bond and no chain interaction to try.

Expect 4+ weeks between first contact and a merged workflow file. Sending these on 2 September means
a plausible answer by early October. Sending them on 1 October means no.

Even one acceptance converts three "not done" items into demonstrated ones. Zero acceptances costs
you an hour and changes nothing else.

---

## 3. Record the video

`VIDEO.md` is the shot list: timings, voiceover, burned-in captions, a pre-flight checklist, and a
list of what to leave out. Read it once through before recording anything.

Two things in it correct `PLAN.md` §8, and both matter on camera:

- **There is no `RugPullBlocked` event to show.** The guard deliberately emits none, because a log
  emitted before a revert is rolled back with it. Show the reverted transaction whose revert reason
  carries `SkillHashMismatch(attested, pinned)` with zero logs. Both hashes appear in the trace,
  which is the stronger shot anyway.
- **There is no measured auto-versus-explicit approval ratio.** The mechanism is real and
  demonstrable. A ratio needs a corpus of third-party updates and none exists. Show the mechanism;
  put no number on screen that nothing measured.

The live beat needs AWS credentials in `.env.local` and the `us.` prefix on the Bedrock model id —
the bare id fails with a `ValidationException`, because Claude on Bedrock is only reachable through a
cross-region inference profile. The first run is slow, since it installs OpenClaw into an isolated
state directory. Do a throwaway run before you record.

If the model is flaky on the day, `VIDEO.md` gives a deterministic fallback:
`cd contracts && forge test --match-test test_theSilentReplacementIsNowSlashable -vvv`. Say on camera
that it is the deterministic path. Do not pretend a test run is a live agent.

Record it. Do not perform it live.

---

## 4. Redeploy the contracts — completed

The redeploy is complete on Monad testnet (chain 10143). The current committed addresses and
configuration now match the audited source, and the account was re-delegated with
`--self-broadcast`. The carried-over ERC-7201 approvals and executor state were cleaned before the
new policy was installed; the publisher, account, executor and slash recipient are separate.

Evidence kept in `.scratch/evidence.json` and `.scratch/m10.txt`:

- delegation: `0x072e5aed8692361b921e77da13373fd785a451b32972dd6991e5412fae9f442c`
- successful `SkillExecuted`: `0xc372dfb6e82eaf372f347973ad76af6c0186b69870c5e893e4b3184f8a6fb5e8`
  (block 62009032; the account balance changed from 10,000 to 9,750 mAUSD)
- refusal: `0x8136418764098f33307db27cd78663f8674a86054d759b3c9e99b8c6db4889f4`
  (`SkillHashMismatch`, reverted, zero logs, no balance change)
- verification: CI is green on `58b84fe`, and `npm run verify:dashboard` passed with exit 0.

The bond asset remains a freely mintable mock on testnet. Cloudflare deployment and automatic pin
publishing still need repository credentials/settings owned by the maintainer; neither is a source
change that can be completed honestly from this checkout.

---

## 5. Envio Cloud (do this late, on purpose)

**Do not do this now.** The free development plan **hard-deletes deployments after 30 days.**
Deploying today means it can vanish around 2 October, nine days before submission, and the failure is
silent from your side.

Deploy in the **first week of October**. Set a reminder.

When you do: install the Envio GitHub App on the repository, add an indexer, and set these three,
which are what make a monorepo work at all:

| Setting | Value |
|---------|-------|
| Root directory | `indexer` |
| Config file | `config.yaml` |
| Deployment branch | `main` |

The directory is already deployable — `envio` is in `dependencies` (a hard requirement it previously
failed), `engines.node` is `>= 24`, `src/EventHandlers.ts` imports nothing outside the directory, and
the package is deliberately not a root workspace member so it resolves its own tree.

Soft limits: 100k events, 5GB, 7 days idle. A breach gives 7 days' grace, then 3 days read-only, then
deletion. `indexer/README.md` has the full detail.

---

## 6. Marketplace listing (optional)

**The Action already works without this.** `uses:` accepts a subdirectory, so
`faizydroid/lockstep/action@v0.1.1` is a complete, valid reference today. A listing adds a searchable
page and nothing else. Skip it if time is short.

It cannot be done from this repository: the Marketplace requires exactly one action per repository
with its metadata at the repository **root**, and this is a monorepo with the metadata at
`action/action.yml`. No configuration changes that.

```powershell
node scripts/publish-action-repo.mjs --dry-run --version v0.1.1   # inspect first
gh repo create faizydroid/lockstep-action --public
node scripts/publish-action-repo.mjs --version v0.1.1
```

Then on that repository: **Releases** → **Draft a new release** → pick tag `v0.1.1` → tick
**Publish this Action to the GitHub Marketplace** → accept the terms → publish.

The script force-pushes `main` there, because it is a generated snapshot with no history worth
keeping, but it pushes tags **without** force, so a released version can never move under someone
consuming it.

---

## 7. Submit

`SUBMISSION.md` is written as a standalone five-minute read for a judge. Use it as the write-up, or
paste from it.

Before you submit, check every link resolves — the dashboard, the repository, the video, and the
Action reference. Dead links are the cheapest possible way to lose points.

Track 04, Monad Metropolis, deadline 11 October 2026.

---

## The tag decision, resolved

**`v0.1.0` stays where it is. `v0.1.1` marks the stable release.** Reasoning, because the
alternative was tempting and wrong.

`v0.1.0` points at `3e65306`, whose CI failed on the missing `_headers` step. Force-moving it to a
green commit was the obvious tidy-up, and I decided against it for one reason that outweighs the
tidiness: **that tree also contains the privilege escalation, the inverted bond pricing, and the
CLI that approved capability-identical byte changes without asking.** Relocating the tag would
quietly delete the record that a vulnerable version was ever tagged, in a project whose entire
credibility rests on documenting its own defects rather than hiding them. A moved tag is also a
force-push to a shared ref on a public repository.

So the history stays intact and `v0.1.1` marks the finalized redeployed release built on the
verified `58b84fe` source. The release commit contains only the documentation and workflow hygiene
needed to make that state reproducible; it does not move `v0.1.0`.

`action/` is byte-identical between `v0.1.0` and the new release, so nothing pinned to the old tag
breaks. Every recommendation in this repository now points at `v0.1.1`, because the tree around the
Action is materially better even where the Action itself is unchanged.

Consume the Action as:

```yaml
- uses: faizydroid/lockstep/action@v0.1.1
```
