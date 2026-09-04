/**
 * What an account's own bytecode says about it.
 *
 * The interesting question a profile can answer is not "what is my address" — the wallet already
 * says that — but **"is anything actually enforcing my approvals right now?"** Under EIP-7702 that is
 * a fact about the account's code, and it is checkable from a single `eth_getCode`.
 *
 * This matters more than it looks, and the reason is in `contracts/test/GatorComparison.t.sol`:
 * delegation changes an account's code but not its storage. Move the delegation elsewhere and the
 * approvals survive in the ERC-7201 slot while nothing is reading them. To anything inspecting
 * storage the account looks exactly as it did while it was protected. So an interface that shows
 * approvals without showing whether they are being enforced is showing the dangerous half.
 */

import type { Address, Hex } from "viem";

/** The three-byte prefix EIP-7702 puts in front of a delegated account's implementation address. */
const INDICATOR_PREFIX = "ef0100";

/** `0xef0100` plus twenty bytes. Twenty-three bytes, and there is room for exactly one address. */
const INDICATOR_BYTES = 23;

export type Delegation =
  /** No code at all. A plain EOA, and nothing is enforcing anything. */
  | { readonly kind: "none" }
  /** Delegated under EIP-7702 to `implementation`. */
  | { readonly kind: "delegated"; readonly implementation: Address }
  /**
   * Has code, but not a delegation indicator — a deployed contract rather than a delegated EOA.
   *
   * Worth distinguishing rather than folding into "none". A contract account cannot carry a 7702
   * delegation, so "you need to delegate this account" would be advice it is impossible to follow.
   */
  | { readonly kind: "contract"; readonly size: number };

/**
 * Reads a delegation indicator out of `eth_getCode` output.
 *
 * Deliberately strict about length. A 7702 indicator is exactly 23 bytes, so anything longer that
 * merely *starts* with the prefix is a contract whose first bytes happen to collide, and treating it
 * as a delegation would report an implementation address assembled from unrelated code.
 */
export function parseDelegation(code: Hex | string | undefined | null): Delegation {
  if (code === undefined || code === null) return { kind: "none" };

  const hex = (code.startsWith("0x") ? code.slice(2) : code).toLowerCase();
  if (hex === "") return { kind: "none" };

  // An odd-length string is not bytes. Refuse rather than silently truncating.
  if (hex.length % 2 !== 0) return { kind: "contract", size: 0 };

  const size = hex.length / 2;

  if (size === INDICATOR_BYTES && hex.startsWith(INDICATOR_PREFIX)) {
    return { kind: "delegated", implementation: `0x${hex.slice(6)}` as Address };
  }

  return { kind: "contract", size };
}

/**
 * The ERC-7201 slot `LockstepGuard` keeps its state in.
 *
 * `keccak256(abi.encode(uint256(keccak256("lockstep.guard.v1")) - 1)) & ~0xff`, matching the constant
 * in `contracts/src/LockstepGuard.sol`. Not derived here and not taken from the source: read back off
 * the live chain from **both** the guard at `0xC41eCe38…3510` and the delegated account at
 * `0x209C903f…aFF2`, which agree. That the account answers with it at all is the behavioural check
 * this constant exists for.
 */
export const GUARD_STORAGE_SLOT =
  "0x723bc0536d6998736ca58b10278e77528d6552c6336394144a42647181e0f200" as Hex;

/**
 * Whether the account's code is a delegation to exactly `guard`.
 *
 * `LockstepGuard.guardStorageSlot()` carries an instruction in its own doc comment: any consumer of
 * that slot must also check the account's code equals `0xef0100 || address(this)` before treating an
 * approval as live. This is that check, and it is why the profile does two things rather than one —
 * the slot call proves the *code* is the guard, this proves the *account* is pointed at it.
 */
export function isDelegatedTo(delegation: Delegation, guard: Address | undefined): boolean {
  if (delegation.kind !== "delegated" || guard === undefined) return false;
  return delegation.implementation.toLowerCase() === guard.toLowerCase();
}

export type GuardCheck =
  /** `guardStorageSlot()` answered with the expected slot. This account runs LockstepGuard. */
  | { readonly kind: "confirmed"; readonly slot: Hex }
  /** It answered, with something else. Delegated to a different implementation. */
  | { readonly kind: "other"; readonly slot: Hex }
  /** It did not answer. Either not delegated, or delegated to code without that function. */
  | { readonly kind: "unanswered" };

/**
 * Whether the delegated code behaves like `LockstepGuard`.
 *
 * Separate from `parseDelegation` because they answer different questions and can disagree, which is
 * the case worth surfacing: an account can carry a valid 7702 indicator pointing at something that is
 * not this guard at all. The first check reads bytes, the second calls a function.
 */
export function describeGuard(slot: Hex | undefined, expected: Hex = GUARD_STORAGE_SLOT): GuardCheck {
  if (slot === undefined) return { kind: "unanswered" };
  return slot.toLowerCase() === expected.toLowerCase()
    ? { kind: "confirmed", slot }
    : { kind: "other", slot };
}

/** One sentence for the interface, matched to the combination rather than to either half alone. */
export function delegationCopy(delegation: Delegation, guard: GuardCheck): string {
  if (delegation.kind === "none") {
    return "This account has no code, so it carries no delegation and nothing is enforcing pin approvals for it. Approvals recorded against it would sit in storage unread.";
  }
  if (delegation.kind === "contract") {
    return `This address is a contract (${delegation.size} bytes), not a delegated EOA. EIP-7702 delegation applies to accounts with a private key, so this one cannot carry a guard.`;
  }
  if (guard.kind === "confirmed") {
    return "Delegated to LockstepGuard, confirmed by calling it rather than by comparing an address. Every fund-moving call from this account is checked against an approved pin before it settles.";
  }
  if (guard.kind === "other") {
    return "Delegated, but the implementation does not answer as LockstepGuard. Approvals for this account are in storage and unenforced — delegation changes code, not storage, so nothing about the stored approvals will look wrong.";
  }
  return "Delegated, but the implementation did not answer a guard call. Treat approvals for this account as unenforced until that resolves.";
}
