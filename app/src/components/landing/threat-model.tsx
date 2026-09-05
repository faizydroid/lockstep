"use client";

/**
 * The boundary, collapsed, at the bottom.
 *
 * ## Why moving it here is right, and where it stops being right
 *
 * The brief is correct that four paragraphs of "out of scope" above the fold is a conversion problem: a
 * reader who has not yet been told what the product does cannot use a list of what it does not do.
 *
 * It stops being right if "buried" means "gone". The strongest single finding in this project's own
 * research was that stating a limit *raises* credibility with an audience that was going to probe for it,
 * and that audience is exactly who reads this page. Every limit below is already in the README, so quietly
 * dropping the panel would leave the claims intact and the honesty invisible — which is the version of
 * this change that would actually cost something.
 *
 * So it is collapsed rather than deleted, it keeps a real heading and a real anchor, and the header links
 * to it directly. A sceptic can reach it in one click from the top of the page.
 *
 * ## Why `<details>` rather than state
 *
 * Keyboard operation, the correct ARIA semantics, and open-by-default-on-print all come free. A div with
 * an onClick would have to reimplement each of them, and this is a security page: an accordion a keyboard
 * user cannot open is a disclosure that does not exist for them.
 */

const LIMITS: readonly { what: string; why: string }[] = [
  {
    what: "A stolen key signing an approved version",
    why: "An attacker holding the executor key who calls the approved skill within its declared capabilities is making a valid call, and it settles. This binds a call to a code version; it is not a second factor on the key.",
  },
  {
    what: "A skill that was hostile from its first publish",
    why: "The mechanism catches bytes changing under a version you already approved. A publisher who was malicious before you ever looked at them never drifts, so nothing here fires. What remains is the bond and the capability diff you read before approving.",
  },
  {
    what: "Which code asked, cryptographically",
    why: "That part is attested by the runtime, not proven. A compromised runtime can report an honest hash while executing something else, and no signature fixes it because the key is reachable by the compromised process. Closing it needs a TEE. Until then the guarantee is economic: a false claim is provable fraud against a bond.",
  },
  {
    what: "Anything that does not move funds",
    why: "Leaked secrets, deleted files, a poisoned reply. This bounds financial blast radius at settlement and is not a general agent sandbox. Indirect prompt injection from content an agent reads is out of scope too.",
  },
];

const NOT_FOR: readonly string[] = [
  "Your agent does not move funds. There is nothing here to bind.",
  "You need to stop a compromised key rather than compromised code. Use a spending limit.",
  "Your account is a contract rather than an EOA. EIP-7702 delegation needs a private key, so it cannot carry a guard.",
];

export function ThreatModel() {
  return (
    <section id="threat-model" className="scroll-mt-16 border-t border-line bg-sunken">
      <div className="mx-auto w-full max-w-4xl px-5 py-14 sm:px-8 sm:py-16">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-start justify-between gap-4 rounded-md">
            <span>
              <span className="hash text-label tracking-wide text-faint">SECTION 06</span>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-text sm:text-2xl">
                Security boundaries &amp; threat model
              </h2>
              <p className="mt-2 max-w-xl text-note leading-relaxed text-muted">
                Four things this does not stop, stated plainly. A security tool that only lists what it
                catches is asking to be taken on trust.
              </p>
            </span>

            {/* Rotates on open. `group-open` is the native details state, so no JavaScript is involved. */}
            <span
              aria-hidden
              className="mt-1 grid size-8 shrink-0 place-items-center rounded-md border border-line-strong text-muted transition-transform group-open:rotate-45"
            >
              <svg viewBox="0 0 24 24" className="size-4" fill="none">
                <path
                  d="M12 5v14M5 12h14"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </summary>

          <div className="mt-8 space-y-px overflow-hidden rounded-lg border border-line bg-line">
            {LIMITS.map((limit) => (
              <div key={limit.what} className="bg-panel p-5">
                <div className="flex items-start gap-3">
                  <span className="hash mt-0.5 shrink-0 rounded border border-line-strong px-1.5 py-0.5 text-label text-faint">
                    OUT OF SCOPE
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-note font-semibold text-text">{limit.what}</h3>
                    <p className="mt-2 text-note leading-relaxed text-muted">{limit.why}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/*
            The line that turns four admissions into a threat model rather than a list of faults. Without
            naming the split, the section reads as a catalogue of things that go wrong.
          */}
          <div className="mt-6 rounded-lg border border-line bg-panel p-5">
            <p className="text-note leading-relaxed text-muted">
              The honest split is that calldata constraints are{" "}
              <span className="font-semibold text-text">cryptographic</span> &mdash; target, selector and
              value ceiling are checked from the transaction itself, whatever anyone claims &mdash; while
              code identity is <span className="font-semibold text-text">economic</span>: a false claim
              about which bytes asked is provable fraud against a bond. Any project asserting otherwise
              without a TEE in the diagram is overclaiming, and one follow-up question exposes it.
            </p>
          </div>

          <div className="mt-6 rounded-lg border border-line bg-panel p-5">
            <p className="hash text-label tracking-wide text-faint">PROBABLY NOT FOR YOU IF</p>
            <ul className="mt-3 space-y-2">
              {NOT_FOR.map((line) => (
                <li key={line} className="flex gap-3 text-note leading-relaxed text-muted">
                  <span aria-hidden className="mt-2 size-1 shrink-0 rounded-pill bg-line-strong" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </details>
      </div>
    </section>
  );
}
