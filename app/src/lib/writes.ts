/**
 * The three transactions this dashboard is allowed to send, as data.
 *
 * Separated from the component that sends them so the interesting part is testable without a wallet: what
 * gets called, on which address, with what arguments, and what a reader is told before they confirm.
 *
 * Every request passes through `buildWrite`, which refuses any function `lib/policy.ts` marks CLI-only.
 * That is redundant -- the ABI has no fragment for those, so viem could not encode one anyway -- and it
 * is deliberately redundant. The two mechanisms fail differently: a missing fragment is a build-time
 * fact, this is a runtime assertion with a message, and a future refactor that adds a fragment for a
 * legitimate reason should still hit a wall here.
 *
 * ## Where these transactions go, which is not obvious
 *
 * `unapprovePin` and `revokeExecutor` live on the LockstepGuard, and under EIP-7702 the guard's code runs
 * at the *account's own address*. So the target is the connected account, not a contract someone
 * deployed. Both are also `onlySelf`, meaning `msg.sender` must equal `address(this)` -- the owner signs
 * a transaction addressed to themselves. An executor deliberately cannot change policy; an agent must
 * never be able to widen its own permissions.
 *
 * The consequence for the UI is that these two only work when the connected wallet *is* the delegated
 * account. Connected as anyone else, the call reverts with `NotSelf`. So the caller checks delegation
 * first rather than offering a button that cannot work.
 *
 * `slashEquivocation` goes to the registry and is permissionless, so any connected address can send it.
 */

import type { Address, Hex } from "viem";

import { lockstepGuardAbi, pinRegistryAbi } from "./abi";
import { CLI_ONLY, ruleFor } from "./policy";

export type WriteName = "unapprovePin" | "revokeExecutor" | "slashEquivocation";

export interface WriteRequest {
  /** Contract to call. For guard functions this is the account itself. */
  readonly to: Address;
  readonly abi: typeof lockstepGuardAbi | typeof pinRegistryAbi;
  readonly functionName: WriteName;
  readonly args: readonly unknown[];
  /** Heading for the confirmation. States the action, not the mechanism. */
  readonly title: string;
  /** What will be true afterwards. */
  readonly effect: string;
  /** What this deliberately does NOT do, which is the part people assume wrongly. */
  readonly limit: string;
  /** Copy for the button that sends it. */
  readonly cta: string;
}

export interface WriteContext {
  /** The connected wallet, which is also the account for guard writes. */
  readonly account: Address;
  readonly registry: Address;
}

/** Thrown rather than returned, because a forbidden call is a programming error, not a user error. */
export class ForbiddenWriteError extends Error {
  constructor(fn: string) {
    const rule = ruleFor(fn);
    super(
      `${fn} may not be sent from a browser. ${rule?.because ?? "See lib/policy.ts."}`,
    );
    this.name = "ForbiddenWriteError";
  }
}

export function buildWrite(
  name: WriteName,
  args: readonly unknown[],
  ctx: WriteContext,
): WriteRequest {
  if (CLI_ONLY.includes(name)) throw new ForbiddenWriteError(name);

  switch (name) {
    case "unapprovePin": {
      const pinId = args[0] as Hex;
      return {
        to: ctx.account,
        abi: lockstepGuardAbi,
        functionName: "unapprovePin",
        args: [pinId],
        title: "Withdraw this approval",
        effect:
          "Every fund-moving call from this skill version starts being refused at settlement, from the next block. Nothing already settled is affected.",
        /*
         * Named because it is the thing people get wrong about revocation.
         *
         * Withdrawing an approval stops future calls. It does not claw back a transfer that already
         * happened, and it does not penalise the publisher -- slashing requires proof of equivocation,
         * which is a different act with a different button.
         */
        limit:
          "It does not reverse anything already spent, and it does not slash the publisher. Re-approving needs the CLI, because approving means vouching for bytes.",
        cta: "Withdraw approval",
      };
    }

    case "revokeExecutor": {
      const executor = args[0] as Address;
      return {
        to: ctx.account,
        abi: lockstepGuardAbi,
        functionName: "revokeExecutor",
        args: [executor],
        title: "Revoke this executor",
        effect:
          "This address can no longer move value through your account. Calls from it revert with NotAuthorizedExecutor.",
        limit:
          "Your approved pins are untouched, so another authorised executor still works. This removes one agent's key, not the policy.",
        cta: "Revoke executor",
      };
    }

    case "slashEquivocation": {
      const [pinIdA, pinIdB] = args as [Hex, Hex];
      return {
        to: ctx.registry,
        abi: pinRegistryAbi,
        functionName: "slashEquivocation",
        args: [pinIdA, pinIdB],
        title: "Challenge this publisher",
        effect:
          "The registry checks both pins are live and share one version id. If they do, the publisher's bond is slashed and half of it is paid to you.",
        /*
         * The registry decides, not the page.
         *
         * Worth saying out loud because a challenge button looks like an accusation the user is making.
         * It is not -- the evidence is already on chain and the contract evaluates it. A challenge
         * against pins that do not actually conflict simply reverts and costs gas.
         */
        limit:
          "You are not making an accusation the chain has to trust. It verifies the two pins itself, and reverts if they do not conflict.",
        cta: "Submit challenge",
      };
    }
  }
}

/**
 * Whether the guard-policy writes can work for this viewer.
 *
 * `onlySelf` means the connected wallet has to be the delegated account. Rather than surfacing a button
 * that reverts, the UI asks this first. `delegatedTo` comes from `eth_getCode` on the account: EIP-7702
 * installs `0xef0100 || implementation`, so the address is readable straight out of the code.
 */
export function isDelegatedToGuard(code: string | undefined, guard: Address): boolean {
  if (code === undefined) return false;
  return code.toLowerCase() === `0xef0100${guard.slice(2).toLowerCase()}`;
}

/** Pulls the implementation address out of a 7702 delegation indicator, if that is what this is. */
export function delegationTarget(code: string | undefined): Address | undefined {
  if (code === undefined) return undefined;
  const m = /^0xef0100([0-9a-fA-F]{40})$/.exec(code);
  return m === null ? undefined : (`0x${m[1]}` as Address);
}
