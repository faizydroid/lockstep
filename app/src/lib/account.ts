/**
 * Whose account the dashboard is reading, and where that answer came from.
 *
 * ## Why the origin is part of the answer
 *
 * Three things can name an account and they are tried in order of how specific each is about *whose* view
 * this is: the build ships a default so a visitor sees something real, a setting is a reader deliberately
 * looking at some other address, and a connected wallet is the strongest statement of all because the person
 * is holding the key.
 *
 * That precedence was fine. What was missing is that the interface never said which rung it landed on, and
 * one transition makes the omission a lie. Disconnecting clears the wallet *and* the setting -- deliberately,
 * because the setting exists to scope the dashboard to "me" and disconnecting is the statement that there is
 * no "me" here any more. The resolution then falls through to the build's address, so every account-scoped
 * figure on the page silently becomes somebody else's. The figures change and nothing explains why.
 *
 * That is the mirror of a bug already fixed once: disconnect used to leave the *same* account showing, so the
 * button reported success while the dashboard carried on reading the reader's own approvals. Same class,
 * opposite direction, and both are the interface being wrong about whose data is on screen.
 *
 * ## Why this is a module and not two expressions
 *
 * `data.tsx` needs the address, to read with. The source banner needs the origin, to disclose. Computing the
 * precedence in both places is a pair that drifts, and the failure mode of a drifted disclosure is the worst
 * available here: a banner confidently naming an account other than the one the figures came from.
 */

import type { Address } from "viem";

/**
 * Which rung the address came from.
 *
 * `none` is a real state, not a gap: a build with no `NEXT_PUBLIC_ACCOUNT_ADDRESS`, nothing in settings and
 * no wallet has no account-scoped data to show at all, and the pages that are about an account should say so
 * rather than render as though the account were simply empty.
 */
export type AccountOrigin = "wallet" | "setting" | "build" | "none";

export interface AccountSource {
  /** Absent only when `origin` is `none`. */
  readonly address?: Address;
  readonly origin: AccountOrigin;
}

export function resolveAccount(input: {
  readonly configured: Address | undefined;
  readonly setting: Address | undefined;
  readonly wallet: Address | undefined;
}): AccountSource {
  /*
   * Most specific first, which is the reverse of how `data.tsx` spreads them.
   *
   * That file builds a config object by overwriting, so the last spread wins and the wallet is written last.
   * Here the same order is expressed as early returns, because a function returning the origin cannot
   * overwrite its way to an answer -- it has to know which rung it stopped on.
   */
  if (input.wallet !== undefined) return { address: input.wallet, origin: "wallet" };
  if (input.setting !== undefined) return { address: input.setting, origin: "setting" };
  if (input.configured !== undefined) return { address: input.configured, origin: "build" };
  return { origin: "none" };
}
