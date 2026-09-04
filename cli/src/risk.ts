/**
 * Client-side mirror of the registry's high-risk selector set.
 *
 * Kept in sync with `contracts/src/HighRiskSelectors.sol` and asserted against
 * the chain in `lockstep publish`, so a drift shows up as a bond quote the CLI
 * did not predict rather than as a silently under-warned capability.
 *
 * Selectors are derived from signatures rather than transcribed, for the same
 * reason as on the Solidity side.
 */

import { toFunctionSelector, type Hex } from "viem";

const SIGNATURES: readonly (readonly [string, string])[] = [
  ["approve(address,uint256)", "grants spending allowance to any address"],
  ["increaseAllowance(address,uint256)", "increases spending allowance"],
  ["setApprovalForAll(address,bool)", "grants control of an entire NFT collection"],
  [
    "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)",
    "grants allowance via signature",
  ],
  ["transfer(address,uint256)", "moves tokens directly"],
  ["transferFrom(address,address,uint256)", "moves tokens from an approved balance"],
  ["safeTransferFrom(address,address,uint256)", "moves an NFT"],
  ["safeTransferFrom(address,address,uint256,bytes)", "moves an NFT"],
  ["delegate(address)", "relocates voting power"],
  ["upgradeTo(address)", "replaces contract implementation"],
  ["upgradeToAndCall(address,bytes)", "replaces implementation and calls it"],
];

export const HIGH_RISK_LABELS: Readonly<Record<string, string>> = Object.fromEntries([
  ...SIGNATURES.map(([signature, label]) => [toFunctionSelector(signature), label] as const),
  // Empty calldata: a bare native-value send to an arbitrary address.
  ["0x00000000", "bare native value transfer to any address"],
]);

export function isHighRiskSelector(selector: Hex): boolean {
  return Object.hasOwn(HIGH_RISK_LABELS, selector.toLowerCase());
}

export function highRiskSelectors(): readonly Hex[] {
  return Object.keys(HIGH_RISK_LABELS) as Hex[];
}
