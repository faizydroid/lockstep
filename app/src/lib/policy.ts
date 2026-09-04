/**
 * Which on-chain actions a web page is allowed to send, and why.
 *
 * This file is the boundary, not a description of it. `abi.ts` may only carry fragments for functions
 * marked `browser` here, a test asserts that, and the export check greps the built bundle for the
 * names marked `cli-only`. Until now the rule was enforced by the ABI simply containing no
 * state-changing functions at all, which was airtight and also meant the dashboard could not offer an
 * emergency stop.
 *
 * ## The rule
 *
 * **A browser may send a transaction whose correctness the contract can check from its own state. It
 * may not send one that asserts a fact about bytes on a disk.**
 *
 * That single sentence classifies all eleven state-changing functions in this system, and it is worth
 * stating as a rule rather than a list because the list will grow.
 *
 * ## Why bytes are the line
 *
 * Approving a skill version means "the code that hashes to this value is the code I want my agent to
 * spend my money running". Nothing a browser can do establishes that. It can show a hash it fetched
 * from a registry, an API, or a link someone sent — and a page that asks you to sign a hash it
 * supplied is the exact shape of the attack this project exists to stop. The CLI can make that claim
 * honestly because it hashes a directory that is on the machine doing the approving, and the user can
 * read that directory.
 *
 * So `approvePin`, `publish` and `execute` stay out of the browser. All three take a `skillHash` or a
 * `pinId` that commits to one, and all three are the moment a human or an agent vouches for bytes.
 *
 * ## Why everything else is fine
 *
 * The remaining eight fall into three groups, none of which requires trusting the page:
 *
 *   Narrowing. `unapprovePin`, `revokeExecutor`, `revoke`. The worst outcome of one sent in error is
 *   that a legitimate call is refused. These belong in a browser more than anywhere else, because they
 *   are the emergency stops: on learning a publisher is compromised you want to kill the approval from
 *   whatever device is to hand, not from a terminal with the repository checked out.
 *
 *   Your own money. `deposit`, `withdraw`, `reclaimBond`. The contract enforces the unbonding delay and
 *   the maturity rules; the page cannot talk it out of them.
 *
 *   Evidence the contract verifies itself. `slashEquivocation` takes two pin ids and the registry checks
 *   that they are both live and share a version id. The browser is not trusted at all — it is only
 *   pointing at facts already on chain. This one arguably needs a UI most: half a slashed bond goes to
 *   the challenger, and without somewhere to click, "permissionless slashing" stays theoretical.
 *
 * ## The one that needed thought
 *
 * `authorizeExecutor` widens power, which is usually where the line goes. It is allowed here because
 * what it grants is bounded by something the browser cannot touch: an authorised executor can only act
 * inside the capabilities of pins the owner has already approved, and approving is CLI-only. So the
 * dangerous half of that decision was already made elsewhere, at the byte level, and what remains is
 * address management. It still gets a confirmation, because "widening" and "safe" are different claims.
 */

export type WriteVerdict = "browser" | "cli-only";

export interface WriteRule {
  readonly contract: "PinRegistry" | "LockstepGuard";
  readonly fn: string;
  readonly verdict: WriteVerdict;
  /** The reason, in one line. Surfaced in the README table and in confirmation copy. */
  readonly because: string;
  /**
   * True when the action grants power rather than removing it.
   *
   * Drives whether the UI demands an explicit confirmation. Narrowing actions get a lighter one, since
   * making an emergency stop harder to reach is its own hazard.
   */
  readonly widens: boolean;
}

/**
 * Every state-changing function in both contracts, classified.
 *
 * Exhaustive by test: `policy.test.ts` compares this list against the compiled artifacts and fails if
 * a contract gains a function that nobody has ruled on. That matters because the failure mode of an
 * incomplete allowlist is a new write silently defaulting to permitted.
 */
export const WRITE_RULES: readonly WriteRule[] = [
  // --- LockstepGuard, at the account address ---
  {
    contract: "LockstepGuard",
    fn: "approvePin",
    verdict: "cli-only",
    because:
      "Vouches that the bytes behind a hash are the bytes you want to run. Only the machine holding them can say that honestly.",
    widens: true,
  },
  {
    contract: "LockstepGuard",
    fn: "execute",
    verdict: "cli-only",
    because:
      "Attests a skill hash for a batch. It is the agent runtime's job, and it makes the same claim about bytes that approving does.",
    widens: true,
  },
  {
    contract: "LockstepGuard",
    fn: "unapprovePin",
    verdict: "browser",
    because:
      "Removes an approval. Strictly narrowing, and the emergency stop you want reachable from a phone.",
    widens: false,
  },
  {
    contract: "LockstepGuard",
    fn: "authorizeExecutor",
    verdict: "browser",
    because:
      "Names an address, not bytes. What it grants is bounded by the pins already approved, and approving is CLI-only.",
    widens: true,
  },
  {
    contract: "LockstepGuard",
    fn: "revokeExecutor",
    verdict: "browser",
    because: "Removes an agent's ability to spend. Narrowing, and urgent when it is needed.",
    widens: false,
  },

  // --- PinRegistry, publisher side ---
  {
    contract: "PinRegistry",
    fn: "publish",
    verdict: "cli-only",
    because:
      "Commits a skill hash and its capability set. Belongs in CI, where the hash is computed from the tree being released.",
    widens: true,
  },
  {
    contract: "PinRegistry",
    fn: "deposit",
    verdict: "browser",
    because: "Moves your own collateral in. No claim about anything.",
    widens: false,
  },
  {
    contract: "PinRegistry",
    fn: "withdraw",
    verdict: "browser",
    because: "Takes unlocked collateral out. The contract enforces the unbonding delay.",
    widens: false,
  },
  {
    contract: "PinRegistry",
    fn: "revoke",
    verdict: "browser",
    because:
      "A publisher withdrawing their own release. Narrowing, and speed matters when a bad version is live.",
    widens: false,
  },
  {
    contract: "PinRegistry",
    fn: "reclaimBond",
    verdict: "browser",
    because: "Recovers collateral from a matured, revoked pin. Pure accounting, and the contract checks maturity.",
    widens: false,
  },
  {
    contract: "PinRegistry",
    fn: "slashEquivocation",
    verdict: "browser",
    because:
      "Points at two pins already on chain and lets the registry check them. The page is never trusted, and the challenger earns half the bond.",
    widens: false,
  },
];

/** Function names a client bundle must never contain a callable fragment for. */
export const CLI_ONLY: readonly string[] = WRITE_RULES.filter((r) => r.verdict === "cli-only").map(
  (r) => r.fn,
);

/** Function names the dashboard may send. */
export const BROWSER_WRITES: readonly string[] = WRITE_RULES.filter(
  (r) => r.verdict === "browser",
).map((r) => r.fn);

export function ruleFor(fn: string): WriteRule | undefined {
  return WRITE_RULES.find((r) => r.fn === fn);
}

/** True when the UI must demand an explicit, typed-out confirmation rather than a single click. */
export function needsHardConfirm(fn: string): boolean {
  const rule = ruleFor(fn);
  return rule !== undefined && rule.verdict === "browser" && rule.widens;
}
