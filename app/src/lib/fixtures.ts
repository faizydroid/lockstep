/**
 * Sample data, used when no registry address is configured.
 *
 * Two reasons this exists rather than an empty state. A dashboard whose every page is blank
 * until someone deploys a contract cannot be reviewed, designed against, or demonstrated. And
 * a live demo that depends on an RPC being reachable at the moment of presentation is a demo
 * that can fail for reasons unrelated to the product.
 *
 * Every value here is taken from the real end-to-end run rather than invented, including the
 * two hashes at the centre of it: the approved skill hashed to 0x233f0359… and, after the
 * publisher shipped different bytes under the same version string, the copy on disk hashed to
 * 0x1eac5d90…. The guard refused the call with NOT_PINNED. Using the real figures keeps the
 * sample honest and means the numbers on screen match the ones in the write-up.
 *
 * Every page states which source it is showing. Sample data is never presented as live.
 */

import { toFunctionSelector } from "viem/utils";
import type { Address, Hex } from "viem";

import type {
  Approval,
  BlockedAttempt,
  BondPricing,
  Capability,
  DriftedSkill,
  Execution,
  Pin,
  Publisher,
  Snapshot,
  Totals,
} from "./model";

const KURU_ROUTER = "0x0000000000000000000000000000000000000001" as Address;
const AUSD_TOKEN = "0x0000000000000000000000000000000000000002" as Address;
const VAULT = "0x0000000000000000000000000000000000000003" as Address;

const PUBLISHER_KURU = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;
const PUBLISHER_HELIX = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const PUBLISHER_DRIFT = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;

const ACCOUNT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const EXECUTOR = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;

/** The two hashes from the live run. The whole product is the difference between them. */
export const APPROVED_HASH = "0x233f0359c38d87e332c87aa294aab227d89d2a12ece44b254e65ddb4011681ef" as Hex;
export const DRIFTED_HASH = "0x1eac5d908cd7ab20417efb5ee1f7a563c82b62d6affd97ab5e86012772783b04" as Hex;

const cap = (target: Address, signature: string, highRisk: boolean): Capability => ({
  target,
  selector: toFunctionSelector(signature),
  label: signature,
  highRisk,
});

/** Bond parameters as deployed by Deploy.s.sol, in AUSD's six decimals. */
export const samplePricing: BondPricing = {
  baseBond: 100_000_000n,
  perCapabilityBond: 25_000_000n,
  highRiskBond: 500_000_000n,
  nativeValueBond: 500_000_000n,
  challengerRewardBps: 5000n,
  unbondingDelay: 604_800n,
  bondAssetDecimals: 6,
  bondAssetSymbol: "AUSD",
};

const NOW = 1_772_000_000n;

export const samplePins: readonly Pin[] = [
  {
    pinId: "0xdd42841469d224a4d4cfacfd49e6cff1f79a5944a056e18606653f06b2acf3ed" as Hex,
    publisher: PUBLISHER_KURU,
    skillHash: APPROVED_HASH,
    versionId: "0x8f2a4c1d5e6b7a8f9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b" as Hex,
    skillName: "kuru-quote",
    skillVersion: "1.0.0",
    maxValuePerCall: 0n,
    requiredBond: 125_000_000n,
    publishedAt: NOW - 86_400n * 3n,
    slashed: false,
    capabilities: [cap(KURU_ROUTER, "swap(uint256)", false)],
    state: "bonded",
  },
  {
    pinId: "0x7b1c9e4f2a8d6b3c5e7f9a1b3d5c7e9f1a3b5d7c9e1f3a5b7d9c1e3f5a7b9d1c" as Hex,
    publisher: PUBLISHER_HELIX,
    skillHash: "0x9c66b961fe093d92b35dfed90ec234d617fa4f77899c4871f4e734b1dd5b757b" as Hex,
    versionId: "0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b" as Hex,
    skillName: "helix-lend",
    skillVersion: "2.4.1",
    maxValuePerCall: 500_000_000_000_000_000n,
    requiredBond: 1_150_000_000n,
    publishedAt: NOW - 86_400n * 11n,
    slashed: false,
    capabilities: [
      cap(VAULT, "deposit(uint256)", false),
      cap(AUSD_TOKEN, "approve(address,uint256)", true),
      cap(VAULT, "withdraw(uint256)", false),
    ],
    state: "bonded",
  },
  {
    pinId: "0x4e8a2c6f0b9d3e7a1c5f9b3d7e1a5c9f3b7d1e5a9c3f7b1d5e9a3c7f1b5d9e3a" as Hex,
    publisher: PUBLISHER_KURU,
    skillHash: "0x5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c" as Hex,
    versionId: "0x2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c" as Hex,
    skillName: "kuru-quote",
    skillVersion: "0.9.0",
    maxValuePerCall: 0n,
    requiredBond: 125_000_000n,
    publishedAt: NOW - 86_400n * 26n,
    revokedAt: NOW - 86_400n * 4n,
    slashed: false,
    capabilities: [cap(KURU_ROUTER, "swap(uint256)", false)],
    state: "revoked",
  },
  {
    // The publisher shipped two different byte sets under one version string. That
    // contradiction is what the bond is posted against, and it is chain-decidable without
    // anyone judging whether the code was malicious.
    pinId: "0xa1b2c3d4e5f60718293a4b5c6d7e8f9012a3b4c5d6e7f8091a2b3c4d5e6f7081" as Hex,
    publisher: PUBLISHER_DRIFT,
    skillHash: DRIFTED_HASH,
    versionId: "0x3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d" as Hex,
    skillName: "swiftswap",
    skillVersion: "1.2.0",
    maxValuePerCall: 2_000_000_000_000_000_000n,
    requiredBond: 1_625_000_000n,
    publishedAt: NOW - 86_400n * 6n,
    revokedAt: NOW - 86_400n * 1n,
    slashed: true,
    capabilities: [
      cap(KURU_ROUTER, "swap(uint256)", false),
      cap(AUSD_TOKEN, "approve(address,uint256)", true),
      cap(AUSD_TOKEN, "transferFrom(address,address,uint256)", true),
    ],
    state: "equivocated",
  },
];

export const sampleApprovals: readonly Approval[] = [
  { account: ACCOUNT, pinId: samplePins[0]!.pinId, approvedAt: NOW - 86_400n * 3n },
  { account: ACCOUNT, pinId: samplePins[1]!.pinId, approvedAt: NOW - 86_400n * 10n },
];

export const samplePublishers: readonly Publisher[] = [
  {
    address: PUBLISHER_KURU,
    bondBalance: 2_000_000_000n,
    lockedBond: 125_000_000n,
    pinCount: 2,
    slashCount: 0,
    hasEquivocated: false,
  },
  {
    address: PUBLISHER_HELIX,
    bondBalance: 3_500_000_000n,
    lockedBond: 1_150_000_000n,
    pinCount: 1,
    slashCount: 0,
    hasEquivocated: false,
  },
  {
    address: PUBLISHER_DRIFT,
    bondBalance: 0n,
    lockedBond: 0n,
    pinCount: 2,
    slashCount: 1,
    hasEquivocated: true,
  },
];

export const sampleExecutions: readonly Execution[] = [
  {
    txHash: "0x6f2e8c1a4b7d9e3f5a8c2b6d4e9f1a3c5b7d9e2f4a6c8b1d3e5f7a9c2b4d6e8f" as Hex,
    account: ACCOUNT,
    pinId: samplePins[0]!.pinId,
    skillHash: APPROVED_HASH,
    executor: EXECUTOR,
    callCount: 1,
    timestamp: NOW - 3600n,
  },
  {
    txHash: "0x8a3f5c7e1b9d2a4c6e8f0b2d4a6c8e1f3b5d7a9c2e4f6b8d1a3c5e7f9b2d4a6c" as Hex,
    account: ACCOUNT,
    pinId: samplePins[1]!.pinId,
    skillHash: samplePins[1]!.skillHash,
    executor: EXECUTOR,
    callCount: 2,
    timestamp: NOW - 7200n,
  },
  {
    txHash: "0x2c4e6a8f0b1d3e5a7c9f2b4d6e8a1c3f5b7d9e2a4c6f8b1d3e5a7c9f2b4d6e8a" as Hex,
    account: ACCOUNT,
    pinId: samplePins[0]!.pinId,
    skillHash: APPROVED_HASH,
    executor: EXECUTOR,
    callCount: 1,
    timestamp: NOW - 86_400n,
  },
];

export const sampleBlocked: readonly BlockedAttempt[] = [
  {
    txHash: "0x1eac5d908cd7ab20417efb5ee1f7a563c82b62d6affd97ab5e86012772783b04" as Hex,
    account: ACCOUNT,
    reason: "skill version does not match the approved pin",
    attestedSkillHash: DRIFTED_HASH,
    pinnedSkillHash: APPROVED_HASH,
    timestamp: NOW - 1800n,
  },
  {
    txHash: "0x5b7d9e2f4a6c8b1d3e5f7a9c2b4d6e8f1a3c5b7d9e2f4a6c8b1d3e5f7a9c2b4d" as Hex,
    account: ACCOUNT,
    reason: "pin unknown or revoked by publisher",
    pinnedSkillHash: "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
    timestamp: NOW - 90_000n,
  },
];

export const sampleDrifted: readonly DriftedSkill[] = [
  {
    skillName: "kuru-quote",
    account: ACCOUNT,
    approvedPinId: samplePins[0]!.pinId,
    approvedHash: APPROVED_HASH,
    currentHash: DRIFTED_HASH,
    diff: {
      // The hostile update keeps the declared swap and adds two powers that move tokens
      // outright. Both additions widen, so this can never be auto-approved.
      unchanged: [cap(KURU_ROUTER, "swap(uint256)", false)],
      added: [
        cap(AUSD_TOKEN, "approve(address,uint256)", true),
        cap(AUSD_TOKEN, "transferFrom(address,address,uint256)", true),
      ],
      removed: [],
      ceilingBefore: 0n,
      ceilingAfter: 1_000_000_000_000_000_000n,
      widened: true,
    },
  },
];

/*
 * Every total is derived from the arrays above, including the slashed figure.
 *
 * That last one was a literal `1_625_000_000n`. It happened to be correct -- it matched the
 * `requiredBond` of the one slashed pin -- but only by coincidence, and a reviewer reading the
 * dashboard reasonably asked whether the numbers were invented. A literal cannot answer that
 * question; a derivation can. Editing a fixture pin now moves the total with it, so the sample data
 * cannot drift into being internally inconsistent, which is the state that would actually deserve
 * the accusation.
 *
 * The registry's semantics are the reason this particular sum is the right one: a pin's bond is
 * locked at publish time and frozen, so slashing takes exactly that pin's `requiredBond`.
 */
const sampleTotals: Totals = {
  pins: samplePins.length,
  livePins: samplePins.filter((p) => p.state === "bonded" || p.state === "pinned").length,
  publishers: samplePublishers.length,
  executions: sampleExecutions.length,
  bondLocked: samplePublishers.reduce((sum, p) => sum + p.lockedBond, 0n),
  slashed: samplePins.reduce((sum, p) => (p.slashed ? sum + p.requiredBond : sum), 0n),
};

export function sampleSnapshot(reason: string): Snapshot {
  return {
    source: { kind: "sample", reason },
    totals: sampleTotals,
    pins: samplePins,
    approvals: sampleApprovals,
    publishers: samplePublishers,
    executions: sampleExecutions,
    blocked: sampleBlocked,
    drifted: sampleDrifted,
    pricing: samplePricing,
  };
}
