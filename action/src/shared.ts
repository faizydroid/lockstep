/**
 * Re-exports the manifest parser, risk table, and ABI the action needs.
 *
 * Kept as a thin indirection so the action bundles one module graph and cannot drift
 * from the CLI's parsing rules. A manifest that publishes from CI must be interpreted
 * exactly as `lockstep publish` would interpret it locally, or the two disagree about
 * what was declared.
 */

export { loadManifest, parseManifest, computeVersionId, type Manifest, type Capability } from "@lockstep/cli/manifest";
export { isHighRiskSelector, HIGH_RISK_LABELS, highRiskSelectors } from "@lockstep/cli/risk";
export { pinRegistryAbi as registryAbi } from "@lockstep/cli/abi";
