# Handover: what only you can do

Everything that can be done from the repository is done. What is left needs an account you own, a
credential only you can mint, a wallet only you can sign with, or your face and voice.

Submission is **11 October 2026**. Today is **2 September 2026**.

| # | Task | Time | Deadline pressure | Blocks |
|---|------|------|-------------------|--------|
| 1 | [Cloudflare Pages + domain](#1-cloudflare-pages-and-the-domain) | ~20 min | do now | the dashboard link in every doc |
| 2 | [Publisher outreach](#2-publisher-outreach-start-this-first) | 1 hr to start | **start now, 4+ week lead** | three demo claims |
| 3 | [Record the video](#3-record-the-video) | ~3 hrs | after 1 | the submission |
| 4 | [Redeploy the contracts](#4-the-redeploy-decision) | ~45 min | your call | honesty of the live addresses |
| 5 | [Envio Cloud](#5-envio-cloud-do-this-late-on-purpose) | ~15 min | **wait until October** | an Envio bounty |
| 6 | [Marketplace listing](#6-marketplace-listing-optional) | ~15 min | optional | discovery only |
| 7 | [Submit](#7-submit) | ~30 min | 11 Oct | — |

Task 2 has the longest lead time and the least to do. Start it before task 1.

---

## Current state, so you can trust the rest of this

CI is green on `eb902c3`, which is `main`. 929 tests: 175 contract across 13 suites including 7
invariants, 678 unit, 76 end-to-end against a real chain.

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
ask — add `faizydroid/lockstep/action@v0.1.0` to their release workflow.

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

## 4. The redeploy decision

**This is a judgement call, and I have deliberately not made it for you.**

The contracts currently deployed on Monad testnet **predate this month's security pass.** Four
exploitable defects were found and fixed in the source; the live addresses do not have those fixes.
Every document in the repository says so, in those words. Nothing is claiming otherwise, so this is
not dishonest as it stands — it is just less impressive than it could be.

**Cost:** simulated at 5,589,160 gas, about **1.135 MON**. The demo account
`0x209C903f68f169C8e654e0C3C91cAdc4C4A4aFF2` holds 4.025 MON, so it is affordable.

**Work after broadcasting:** roughly six signed transactions, then rotating the new addresses through
~15 files — `.env.example`, `README.md`, `SUBMISSION.md`, both workflows' seven `NEXT_PUBLIC_*`
values, and three values in `indexer/config.yaml` (`start_block`, the registry address, and the
`0xef0100 || guard` comment). `indexer/README.md` lists that last set precisely. Then re-run CI, and
re-record any video beat showing an address.

**One trap:** the demo account's code is `0xef0100c41ece…`, meaning it is EIP-7702 delegated to the
**old** guard. A new guard means re-signing the delegation, or the account keeps routing through the
contract you just replaced. This is the step most likely to be forgotten, and the symptom is a demo
that appears to work while proving nothing.

**My read:** do it only if you are recording the video afterwards, not before. A redeploy that
invalidates footage you already shot costs more than it gains. If the video is done and the addresses
are stale, leave them and let the disclosure stand — it is already written and a judge who reads it
sees deliberate scoping rather than a gap.

Everything is staged: `.scratch\sim-deploy.cmd`, which needs `--tc Deploy`. The only key present is
`ACCOUNT_PRIVATE_KEY` in `.env.local`.

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
`faizydroid/lockstep/action@v0.1.0` is a complete, valid reference today. A listing adds a searchable
page and nothing else. Skip it if time is short.

It cannot be done from this repository: the Marketplace requires exactly one action per repository
with its metadata at the repository **root**, and this is a monorepo with the metadata at
`action/action.yml`. No configuration changes that.

```powershell
node scripts/publish-action-repo.mjs --dry-run --version v0.1.0   # inspect first
gh repo create faizydroid/lockstep-action --public
node scripts/publish-action-repo.mjs --version v0.1.0
```

Then on that repository: **Releases** → **Draft a new release** → pick tag `v0.1.0` → tick
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

## One decision I left for you

The tag `v0.1.0` points at `3e65306`, and **CI failed on that commit.** The failure was the missing
`_headers` step, fixed in `691dcba`.

`action/` and `LICENSE` are byte-identical between the tag and `main` — the only difference in the
whole tree is two workflow files — so `faizydroid/lockstep/action@v0.1.0` is correct and unaffected.
But the repository *at that tag* does not pass its own CI, and that is visible to anyone who looks.

Moving a published tag is normally the wrong instinct. Here it is about an hour old, nothing consumes
it, and no release has been drafted from it. My recommendation is to move it to the green commit:

```powershell
git tag -f -a v0.1.0 -m "v0.1.0 - first tagged release"
git push --force origin v0.1.0
```

That is a force-push to a shared ref, which is why I have not run it. Say the word and I will, or
run it yourself, or leave it and cut `v0.1.1` from `main` instead — that is the non-destructive
option and it is equally defensible.
