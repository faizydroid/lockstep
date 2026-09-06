# The 3-minute video

Shot list, voiceover and captions for the Metropolis submission. Timed to 3:00 with about six
seconds of slack.

**Record it. Do not perform it live.** Every beat below is a take you can retry, and the one that
matters — the rug pull being refused — is a real transaction against a real chain, which means it can
be slow or fail for reasons unrelated to the product.

## Two corrections to the plan's script

`PLAN.md` §8 is the source for these beats, and two details in it are now wrong.

**There is no `RugPullBlocked` event to show.** The guard deliberately does not emit one: a log
emitted immediately before a revert is rolled back with it, so no indexer ever receives it, and gas
measurement showed the dead emit made rejection cost *more* than a successful execution. The refusal
is visible as a **reverted transaction whose revert reason carries `SkillHashMismatch(attested,
pinned)`**, with **zero logs**. That is a stronger shot anyway: nothing happened, and the two hashes
are right there in the trace.

**There is no measured auto/explicit approval ratio.** The *mechanism* is real and demonstrable — a
capability-identical update re-approves silently, a widened one asks — but a ratio needs a corpus of
real third-party skill updates, and no third party has pinned a skill yet. Show the mechanism. Do not
put a number on screen that nothing measured.

## Before you record

- [ ] `npm run verify:dashboard` passes, and https://lockstep.dofolabs.space is live.
- [ ] AWS credentials in `.env.local` still work — beat 3 uses a real model.
- [ ] Do one full `--rug-pull` rehearsal run. First runs are slow: it installs OpenClaw into an
      isolated state directory.
- [ ] Terminal at a large font, dark theme, window ~100 columns. Hide any path with your username in
      it.
- [ ] Browser at 1440×900, no bookmarks bar, no extensions visible.
- [ ] Captions burned in or as an uploaded `.srt`. Judges watch on mute more often than anyone admits.

---

## 0:00–0:20 · The number

**Screen.** Black, one statistic at a time, large type. No logo yet.

**Voiceover.**
> Three hundred and forty-one malicious agent skills, planted on one hub in a single campaign,
> aimed at roughly three hundred thousand users. Ninety-one percent of them carry prompt injection.
> And prompt injection still succeeds most of the time *with* model guardrails switched on.
> You are not going to fix this at the model layer.

**Captions.**
```
341 malicious skills. One coordinated campaign.
~300,000 agent users exposed.
91% of malicious skills carry prompt injection. 0% of the legitimate top 100.
Injection succeeds 57–72% of the time WITH model guardrails.
You cannot fix this at the model layer.
```

**Note.** Source links are in `SUBMISSION.md`. Do not read URLs aloud.

---

## 0:20–0:45 · The gap

**Screen.** Split. Left: a `gator grant --scope functionCall` command with `--targets`,
`--selectors`, `--valueLte`. Right: a skill's `SKILL.md` being edited — change the description, save.

**Voiceover.**
> Spend limits and allowlists are good, and they answer a different question. They bound *how much*
> an agent may move and *which function* it may call. Neither of them knows *which code asked*.
> The skill description ships with every list the agent loads at runtime. Change it, and the agent
> picks it up automatically. The user gets no signal at all.

**Captions.**
```
Gator's functionCall caveat: --targets, --selectors, --valueLte.
It bounds how much, and which selector.
It cannot see which code asked.
Change the skill, the agent reloads it. No prompt. No signal.
```

**Note.** Be fair to MetaMask here. `contracts/test/GatorComparison.t.sol` shows both layers agreeing
on every call the *approved* skill makes; they diverge only when the bytes change. Complementary, not
competing — and saying so is more credible than a straw man.

---

## 0:45–1:30 · The rug pull, live

The centrepiece. 45 seconds, two runs, one command each.

**Setup shot (0:45–0:52).** Show the honest run landing.

```bash
node scripts/live-dispatch.mjs --provider bedrock \
  --model amazon-bedrock/us.anthropic.claude-sonnet-4-5-20250929-v1:0
```

**Voiceover.**
> A real model reads a real skill and calls a tool that moves funds. The account approved this exact
> version, so it settles.

Cut to the `SkillExecuted` line in the output.

**The attack (0:52–1:20).** Same command, one flag.

```bash
node scripts/live-dispatch.mjs --provider bedrock \
  --model amazon-bedrock/us.anthropic.claude-sonnet-4-5-20250929-v1:0 --rug-pull
```

**Voiceover.**
> Now the publisher replaces the approved bytes with hostile ones, after approval. Same skill name.
> Same version string. Nothing the user can see has changed.
> The agent does exactly what it is told. And it is refused before settlement.

**Screen.** The harness output showing `NOT_PINNED`, then cut to the revert trace: the two hashes
side by side and the log count.

**Captions.**
```
Same command. One flag: --rug-pull.
Approved bytes replaced AFTER approval.
Same name. Same version. No visible change.
REFUSED before settlement.
SkillHashMismatch(attested, pinned) — and zero logs. Nothing moved.
```

**Note.** The two hashes differ in almost every character. That is the shot. Hold on it for two full
seconds — it is the single most convincing frame in the video.

**Fallback if the model call is flaky on the day:** use the deterministic path instead and say so.
`cd contracts && forge test --match-test test_theSilentReplacementIsNowSlashable -vvv` shows the same
refusal without a model in the loop. An honest fallback beats a re-shot take that implies a live
model when there wasn't one.

---

## 1:30–2:00 · Why it does not annoy anyone

**Screen.** The dashboard's `/drift` page at https://lockstep.dofolabs.space/drift, then the
settlement-gate toggle on that page.

**Voiceover.**
> Enforcement that nags gets switched off, so this is the half that decides whether anyone keeps it
> on. A publisher recompiles and every byte changes, but the declared powers are identical — that
> re-approves silently. A release that adds a capability, or raises the value ceiling, is the only
> thing that asks. One new target-and-selector pair, or a higher ceiling. Nothing else.

**Screen.** Flip the toggle: same call, settles, then turned away.

**Captions.**
```
Capability-identical update → re-approved silently.
Widened → an explicit diff and an ask.
Widening is exactly two things: a new (target, selector) pair, or a higher value ceiling.
Removing a capability is a narrowing. It never asks.
```

**Note.** Do not claim a percentage. See the corrections at the top.

---

## 2:00–2:30 · Why Monad

**Screen.** Two tables from the README, on screen long enough to read.

**Voiceover.**
> Enforcement costs about forty thousand gas on top of a call that would have happened anyway, and
> batching amortises the fixed check to roughly three thousand per additional call. Refusing is
> cheaper than settling, which is why the safe path is also the cheap one.
> The number that actually matters is capital efficiency. A bond secures value in proportion to how
> fast a challenge can land. Six-second finality against four minutes is about forty times the
> economic throughput per unit of locked capital. That is why this is on Monad and not somewhere
> slower.

**Captions.**
```
Enforcement overhead: 40,029 gas. ~3.1k per additional call in a batch.
Refusing (62,181) is cheaper than settling. The safe path is the cheap path.
Bond velocity: B/W. 6s window vs 4min ≈ 40x capital efficiency.
Measured in contracts/test/BondVelocity.t.sol
```

**Note.** If you show 115,207 as well, say what it is — a whole transaction including the token
transfer — or it looks like the 40k number is wrong. The README reconciles them.

---

## 2:30–3:00 · Why it spreads, and what we found in our own code

**Screen.** The GitHub Action's run summary with the badge, then the four-defect table from
`SUBMISSION.md`.

**Voiceover.**
> Distribution is the moat, not the contract. The mechanism is a week of work to copy; being inside a
> publisher's release pipeline is not. So it ships as a GitHub Action with two refusals built in: it
> will not help you publish two conflicting claims about one version, and it fails the build when a
> release widens what a skill can do.
> One last thing, and it is the part we would want to be judged on. We ran a first-principles review
> of our own contracts and found four exploitable holes — three of them free to exploit — every one
> in a mechanism this repository already described as working. They are fixed, each proven by
> switching the fix off and watching the tests fail, and all four are written up in full.
> A company raised fifty million dollars this month to *scan* for this problem. Lockstep enforces
> it, on chain, at the moment money moves.

**Captions.**
```
Ships as a GitHub Action. Two refusals: no self-slashing, no silent widening.
We audited our own code and published what we found.
4 exploitable defects. 3 free to exploit. All in mechanisms we had already called "working".
Each fix verified by disabling it and watching the tests fail.
929 tests. 175 Solidity, 7 invariants.
AIR raised $50M to scan this. Lockstep enforces it at settlement.
```

**Final frame.** Hold 3 seconds, no voiceover.
```
Lockstep
lockstep.dofolabs.space
github.com/faizydroid/lockstep
```

---

## What not to put in

Cut ruthlessly. Each of these has been tempting and each costs more than it returns.

- **A walkthrough of the contracts.** Nobody watches Solidity for three minutes. The tests are the
  evidence and they are in the repo.
- **The dashboard tour.** Beat 4 needs one page. Six more prove nothing about the product.
- **A claimed bond figure without the caveat.** The testnet bond asset is a freely mintable mock. If a
  number appears on screen, the disclosure has to be visible in the same frame — it already is on the
  bonds page, which is why beat 4 uses `/drift` instead.
- **"Solves prompt injection."** It does not, and a judge who catches that discounts everything else.
  The line is *makes it unprofitable*.
- **Anything about mainnet.** There is no mainnet deployment, on purpose, and the write-up says why.
