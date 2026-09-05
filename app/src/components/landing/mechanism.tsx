"use client";

/**
 * Three cards for the lifecycle, and the install block.
 *
 * Cards rather than a flow diagram, which is what the brief asked for and is the right call: a faded
 * three-node flowchart with arrows is the single most common way infrastructure landing pages say nothing.
 * Each card here carries the actual identifier involved -- the function called, the comparison made, the
 * error returned -- so a reader who knows Solidity can check the claim instead of taking the arrow's word.
 *
 * Step three is deliberately two outcomes in one card rather than two cards. The gate opening and the gate
 * snapping shut are the same branch, and splitting them would imply a sequence where there is a choice.
 */

const STEPS: readonly {
  n: string;
  title: string;
  body: string;
  code: readonly string[];
}[] = [
  {
    n: "01",
    title: "Publisher ships a version",
    body: "Publishing hashes the skill directory and locks a bond priced by what that version declared it may do — blast radius, not market value.",
    code: ["publish(skillHash, capabilities)", "→ bond locked"],
  },
  {
    n: "02",
    title: "The guard compares two hashes",
    body: "An EIP-7702 delegation points the account at LockstepGuard. It reads the hash pinned in the registry and the hash the call handed over. It never reads the code, so there is nothing in it to argue with.",
    code: ["liveSkillHash(pinId)", "== attestedSkillHash"],
  },
  {
    n: "03",
    title: "It settles, or it does not",
    body: "Equal hashes and the call proceeds. Different hashes and it reverts in the same transaction, before value moves. No event is emitted on refusal, because a log written before a revert is rolled back.",
    code: ["✓ SkillExecuted", "✗ revert NOT_PINNED"],
  },
];

export function Mechanism() {
  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
      <div className="max-w-2xl">
        <p className="hash text-label tracking-wide text-faint">THE MECHANISM</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-text sm:text-3xl">
          Three steps, and only one of them is ours
        </h2>
        <p className="mt-3 text-note leading-relaxed text-muted sm:text-base">
          The publisher acts, the account owner approves, and the guard does arithmetic. Nothing in the
          middle needs to be trusted, which is the only reason the last step can be relied on.
        </p>
      </div>

      <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-3">
        {STEPS.map((step) => (
          <div key={step.n} className="flex flex-col bg-panel p-5 sm:p-6">
            <span className="hash text-label tracking-wide text-faint">{step.n}</span>

            <h3 className="mt-4 text-base font-semibold tracking-tight text-text">{step.title}</h3>
            <p className="mt-3 flex-1 text-note leading-relaxed text-muted">{step.body}</p>

            <div className="mt-5 space-y-1 rounded-md border border-line bg-sunken p-3">
              {step.code.map((line) => (
                <p
                  key={line}
                  className={`hash text-label ${
                    line.startsWith("✗")
                      ? "text-revoked-ink"
                      : line.startsWith("✓") || line.startsWith("→")
                        ? "text-bonded-ink"
                        : "text-muted"
                  }`}
                >
                  {line}
                </p>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div id="install" className="mt-12 scroll-mt-20">
        <div className="overflow-hidden rounded-lg border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line bg-raise px-4 py-2.5">
            <span className="hash text-label tracking-wide text-faint">INSTALL</span>
            <span className="hash text-label text-faint">node ≥ 22</span>
          </div>
          <pre className="overflow-x-auto px-4 py-4">
            <code className="hash block text-note leading-relaxed text-muted">
              <span className="text-faint select-none">$ </span>
              <span className="text-text">npx @lockstep/cli hash ./your-skill</span>
              {"\n"}
              <span className="text-faint select-none">$ </span>
              <span className="text-text">npx @lockstep/cli publish ./your-skill</span>
              {"\n"}
              <span className="text-faint select-none">$ </span>
              <span className="text-text">npx @lockstep/cli approve ./your-skill</span>
            </code>
          </pre>
        </div>

        {/*
          Said next to the commands rather than in a docs page, because it is the objection a developer has
          while reading them: why is approving not a button on this page.
        */}
        <p className="mt-3 max-w-2xl text-label leading-relaxed text-faint">
          Approving runs locally by design. An approval commits to exact bytes, and only the machine holding
          those bytes can make that claim honestly &mdash; a web page asking you to sign a hash it fetched is
          the shape of the attack this exists to stop.
        </p>
      </div>
    </section>
  );
}
