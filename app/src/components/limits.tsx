"use client";

/**
 * What Lockstep does not stop.
 *
 * ## Why a limitations panel is on the marketing surface
 *
 * The single most transferable finding in the onboarding material was counter-intuitive: stating a
 * limitation *raises* credibility rather than lowering it. The example given was a weight-loss app whose
 * onboarding says results are slow for the first week — framed as reducing refunds, and reading as
 * confidence rather than as a hedge.
 *
 * For this product it is stronger than a credibility trick. The audience is security-literate developers
 * and the judges are the same people, and the first thing a sceptic does with a security claim is probe
 * its edges. Every limit below is already stated in the README — the attestation gap, the out-of-scope
 * paragraph, the note that calldata constraints are cryptographic while code identity is economic — and
 * none of it was anywhere in the interface. A reader who found the boundary themselves, after being sold
 * the strong version, would be right to discount everything else on the page.
 *
 * So this is not hedging and it is not new information. It is the README's own honesty, moved to where a
 * first-time reader will actually meet it.
 *
 * ## Why it is copy and not a component with state
 *
 * These facts do not vary by account, chain or configuration. Anything that derived them from a snapshot
 * would imply they might come out differently, and they do not.
 */

import { Card, Pill, Section } from "./ui";

interface Limit {
  readonly what: string;
  readonly why: string;
}

/**
 * Four limits, each one a real boundary rather than a softened version of a strength.
 *
 * Ordered by how likely a reader is to think of it, which is roughly inverse to how often products admit
 * it. The stolen key is first because it is the objection anyone reaches within ten seconds.
 */
const LIMITS: readonly Limit[] = [
  {
    what: "A stolen key signing an approved version",
    why: "If an attacker holds the executor key and calls the approved skill within its declared capabilities, that is a valid call and it settles. Lockstep binds a call to a code version; it is not a second factor on the key.",
  },
  {
    what: "A skill that was hostile from its first publish",
    why: "The mechanism catches bytes changing under a version you already approved. A publisher who was malicious before you ever looked at them never drifts, so nothing here is triggered. What remains is the bond — and the capability diff you read before approving.",
  },
  {
    what: "Which code asked, cryptographically",
    why: "That part is attested by the runtime, not proven. A compromised runtime can report an honest hash while executing something else, and no signature fixes it, because the key would be reachable by the compromised process. Closing it needs a TEE. Until then the guarantee is economic: a false claim is provable fraud against a bond.",
  },
  {
    what: "Anything that does not move funds",
    why: "Leaked secrets, deleted files, a poisoned reply. Lockstep bounds financial blast radius at settlement and is not a general agent sandbox. Indirect prompt injection from content an agent reads is out of scope too.",
  },
];

export function Limits() {
  return (
    <Section
      eyebrow="The boundary"
      title="What this does not stop"
      description={
        <>
          Worth reading before the rest, because a security tool that only lists what it catches is
          asking to be taken on trust. Each of these is a real limit, not a softened strength.
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2 2xl:gap-6">
        {LIMITS.map((limit) => (
          <Card key={limit.what} className="bg-raise">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="attention">out of scope</Pill>
            </div>
            <h3 className="font-display mt-3 text-base leading-tight font-extrabold text-text">
              {limit.what}
            </h3>
            <p className="mt-2 text-sm leading-relaxed font-semibold text-muted">{limit.why}</p>
          </Card>
        ))}
      </div>

      {/*
        The line that makes the list an argument rather than a disclaimer.

        Naming the split -- cryptographic where it can be, economic where it cannot -- is what turns four
        admissions into a threat model. Without it the panel reads as a list of things that go wrong.
      */}
      <Card tone="pinned">
        <p className="measure text-sm leading-relaxed font-semibold text-muted">
          The honest split is that calldata constraints are{" "}
          <strong className="font-extrabold text-text">cryptographic</strong> &mdash; target, selector and
          value ceiling are checked from the transaction itself, whatever anyone claims &mdash; while code
          identity is <strong className="font-extrabold text-text">economic</strong>: a false claim about
          which bytes asked is provable fraud against a bond. Any project asserting otherwise without a
          TEE in the diagram is overclaiming, and one follow-up question exposes it.
        </p>
      </Card>
    </Section>
  );
}

/**
 * Who this is not for.
 *
 * The onboarding material's golden rule was that you cannot onboard someone you do not understand, and
 * the corollary it kept returning to is that knowing the *non*-audience is a constraint you can use.
 * Stating it costs one paragraph and reads as confidence; the alternative is a reader spending five
 * minutes working out that the product does not apply to them and concluding it is vague.
 */
export function NotFor() {
  return (
    <Card className="bg-raise">
      <p className="shout text-[0.65rem] text-faint">Probably not for you if</p>
      <ul className="mt-3 grid gap-2 text-sm leading-relaxed font-semibold text-muted">
        <li>
          &mdash; Your agent does not move funds. The enforcement point is a transaction, so there is
          nothing here for an agent that only reads.
        </li>
        <li>
          &mdash; You write every line your agent runs. The problem being solved is a third party
          changing code you approved; if there is no third party, the bond is buying you nothing.
        </li>
        <li>
          &mdash; The account holding the funds is a contract rather than an EOA. EIP-7702 delegation
          needs a private key, so a contract account cannot carry the guard.
        </li>
      </ul>
    </Card>
  );
}
