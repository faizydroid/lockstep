/**
 * What the UI displays, and nothing else.
 *
 * Deliberately not the on-chain `Pin` struct and not the indexer's `Pin` entity. Both are
 * shaped for their own jobs: the struct is packed for a single-SLOAD hot path, the entity is
 * shaped for GraphQL relations. A view needs a third thing -- flattened, already-derived,
 * with the questions a reader actually asks answered up front ("is this live", "is this
 * bonded", "did the publisher contradict themselves").
 *
 * Deriving that once, here, keeps the components free of chain semantics. A card should not
 * be the place where someone learns that `revokedAt != 0` means revoked.
 */

import type { Address, Hex } from "viem";

/**
 * Whether a pin can currently vouch for a transaction, and if not, why.
 *
 * Ordered by severity, because that is the order a reader cares about. `equivocated` outranks
 * `revoked`: a publisher caught making conflicting claims is a different kind of problem from
 * one who withdrew a release.
 */
export type PinState = "bonded" | "pinned" | "revoked" | "equivocated";

export interface Capability {
  readonly target: Address;
  /** 4-byte selector, lower-cased. */
  readonly selector: Hex;
  /** Signature when known (`swap(uint256)`), otherwise the selector again. */
  readonly label: string;
  /**
   * Allowance-granting, transfer, or authority-relocating.
   *
   * Authoritative source is the registry's own `isHighRiskSelector` mapping, mirrored into
   * the `CapabilityDeclared` event, so this is read rather than recomputed client-side.
   */
  readonly highRisk: boolean;
}

export interface Pin {
  readonly pinId: Hex;
  readonly publisher: Address;
  readonly skillHash: Hex;
  /** keccak256(name, version). Two live pins sharing one is provable equivocation. */
  readonly versionId: Hex;
  /** Human name and version, when a manifest is available. Never trusted for identity. */
  readonly skillName?: string;
  readonly skillVersion?: string;
  /** Native-value ceiling per call, in wei. */
  readonly maxValuePerCall: bigint;
  /** Bond locked at publish time, in bond-asset units. Frozen per pin. */
  readonly requiredBond: bigint;
  readonly publishedAt: bigint;
  readonly revokedAt?: bigint;
  readonly slashed: boolean;
  readonly capabilities: readonly Capability[];
  readonly state: PinState;
}

export interface Approval {
  readonly account: Address;
  readonly pinId: Hex;
  readonly approvedAt: bigint;
}

/**
 * A skill on disk whose bytes no longer match what the account approved.
 *
 * This is the product in one object. `approvedHash` is what the user agreed to,
 * `currentHash` is what would run, and while they differ every fund-moving call from that
 * skill is refused at settlement.
 */
export interface DriftedSkill {
  readonly skillName: string;
  readonly account: Address;
  readonly approvedPinId: Hex;
  readonly approvedHash: Hex;
  readonly currentHash: Hex;
  /** Capability changes between the approved version and the one on disk. */
  readonly diff: CapabilityDelta;
}

export interface CapabilityDelta {
  readonly added: readonly Capability[];
  readonly removed: readonly Capability[];
  readonly unchanged: readonly Capability[];
  readonly ceilingBefore: bigint;
  readonly ceilingAfter: bigint;
  /**
   * True when the new version can do something the old one could not.
   *
   * The rule that decides whether a human is interrupted. A new (target, selector) pair or a
   * higher ceiling widens; removing a capability or lowering the ceiling narrows and is
   * auto-approvable. Prompting on every release is how permission systems teach people to
   * click through without reading.
   */
  readonly widened: boolean;
}

export interface Publisher {
  readonly address: Address;
  readonly bondBalance: bigint;
  readonly lockedBond: bigint;
  readonly pinCount: number;
  readonly slashCount: number;
  readonly hasEquivocated: boolean;
}

export interface Execution {
  readonly txHash: Hex;
  readonly account: Address;
  readonly pinId: Hex;
  readonly skillHash: Hex;
  readonly executor: Address;
  readonly callCount: number;
  readonly timestamp: bigint;
}

/**
 * A fund-moving call the guard refused.
 *
 * Reconstructed from reverted-transaction traces, not from logs. The guard emits nothing on
 * refusal because a log written before a revert is rolled back and never reaches an indexer,
 * so there is no feed to subscribe to -- a detail worth surfacing rather than hiding, since
 * it is why this list can be sparse.
 */
export interface BlockedAttempt {
  readonly txHash: Hex;
  readonly account: Address;
  readonly reason: string;
  readonly attestedSkillHash?: Hex;
  readonly pinnedSkillHash?: Hex;
  readonly timestamp: bigint;
}

/** Registry-wide bond pricing, read from the deployed contract's immutables. */
export interface BondPricing {
  readonly baseBond: bigint;
  readonly perCapabilityBond: bigint;
  readonly highRiskBond: bigint;
  readonly nativeValueBond: bigint;
  readonly challengerRewardBps: bigint;
  readonly unbondingDelay: bigint;
  /** Decimals of the bond asset. AUSD is 6, which is why bonds are never formatted as ether. */
  readonly bondAssetDecimals: number;
  readonly bondAssetSymbol: string;
}

export interface Totals {
  readonly pins: number;
  readonly livePins: number;
  readonly publishers: number;
  readonly executions: number;
  readonly bondLocked: bigint;
  readonly slashed: bigint;
}

/**
 * Everything a page renders, plus where it came from.
 *
 * `source` is not decoration. A dashboard showing sample data must say so, or it invites a
 * reader to believe a number that is invented. Every page surfaces this.
 */
export interface Snapshot {
  readonly source: DataSource;
  readonly totals: Totals;
  readonly pins: readonly Pin[];
  readonly approvals: readonly Approval[];
  readonly publishers: readonly Publisher[];
  readonly executions: readonly Execution[];
  readonly blocked: readonly BlockedAttempt[];
  readonly drifted: readonly DriftedSkill[];
  readonly pricing: BondPricing;
}

export type DataSource =
  | { readonly kind: "chain"; readonly chainId: number; readonly registry: Address; readonly blockNumber: bigint }
  | { readonly kind: "sample"; readonly reason: string }
  | { readonly kind: "error"; readonly reason: string };

/** Derives display state from the raw flags, in severity order. */
export function pinStateOf(pin: {
  readonly slashed: boolean;
  readonly revokedAt?: bigint;
  readonly requiredBond: bigint;
  readonly publisherHasEquivocated?: boolean;
}): PinState {
  if (pin.slashed || pin.publisherHasEquivocated === true) return "equivocated";
  if (pin.revokedAt !== undefined && pin.revokedAt !== 0n) return "revoked";
  return pin.requiredBond > 0n ? "bonded" : "pinned";
}

/** True when the pin can currently vouch for a transaction. */
export function isLive(pin: Pin): boolean {
  return pin.state === "bonded" || pin.state === "pinned";
}
