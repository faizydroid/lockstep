/**
 * Reads and validates a `lockstep.json` capability manifest.
 *
 * The manifest is the publisher's declaration of what a skill may do on chain. It
 * is validated strictly and rejected on anything unexpected, because a typo that
 * quietly widens capability is exactly the failure this file exists to prevent.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  encodeAbiParameters,
  getAddress,
  isAddress,
  keccak256,
  toFunctionSelector,
  type Address,
  type Hex,
} from "viem";

export interface Capability {
  readonly target: Address;
  readonly selector: Hex;
  /** Original signature or selector, for display. */
  readonly label: string;
}

export interface Manifest {
  readonly schema: string;
  readonly name: string;
  readonly version: string;
  readonly capabilities: readonly Capability[];
  readonly maxValuePerCall: bigint;
  /**
   * Canonical version identifier, committed on chain so equivocation is provable.
   *
   * Must match `PinRegistry.computeVersionId`, which uses `abi.encode` rather than
   * concatenation. That matters: concatenating would let ("ab","c") and ("a","bc")
   * collide into one version, so two unrelated skills could be made to look like a
   * publisher contradicting itself.
   */
  readonly versionId: Hex;
}

/** Mirror of `PinRegistry.computeVersionId`. */
export function computeVersionId(name: string, version: string): Hex {
  return keccak256(encodeAbiParameters([{ type: "string" }, { type: "string" }], [name, version]));
}

export const MANIFEST_FILENAME = "lockstep.json";

/**
 * Selectors are accepted either as a full signature or as a 4-byte hex string.
 *
 * Signatures are strongly preferred and the CLI says so on publish: `0x095ea7b3`
 * is unreviewable, while `approve(address,uint256)` tells a reader they are about
 * to grant allowance-granting power.
 */
function parseSelector(raw: unknown, where: string): { selector: Hex; label: string } {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error(`${where}: selector must be a non-empty string`);
  }
  if (/^0x[0-9a-fA-F]{8}$/.test(raw)) {
    return { selector: raw.toLowerCase() as Hex, label: raw.toLowerCase() };
  }
  if (raw === "" || !raw.includes("(") || !raw.endsWith(")")) {
    throw new Error(
      `${where}: selector must be a function signature such as 'swap(uint256)' or a 4-byte hex string, got '${raw}'`,
    );
  }
  return { selector: toFunctionSelector(raw), label: raw };
}

function parseValue(raw: unknown): bigint {
  if (raw === undefined || raw === null) return 0n;
  if (typeof raw === "number") {
    // A float here would silently truncate. Refuse rather than guess.
    if (!Number.isSafeInteger(raw) || raw < 0) {
      throw new Error("maxValuePerCall must be a non-negative integer, given as a string in wei");
    }
    return BigInt(raw);
  }
  if (typeof raw === "string" && /^[0-9]+$/.test(raw)) return BigInt(raw);
  throw new Error("maxValuePerCall must be a decimal string in wei, for example '500000000000000000'");
}

export function parseManifest(json: unknown): Manifest {
  if (typeof json !== "object" || json === null) {
    throw new Error("manifest must be a JSON object");
  }
  const m = json as Record<string, unknown>;

  const name = m.name;
  const version = m.version;
  if (typeof name !== "string" || name.length === 0) throw new Error("manifest.name is required");
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("manifest.version is required");
  }

  const onchain = (m.capabilities as Record<string, unknown> | undefined)?.onchain;
  if (typeof onchain !== "object" || onchain === null) {
    throw new Error("manifest.capabilities.onchain is required");
  }
  const oc = onchain as Record<string, unknown>;

  const rawCalls = oc.calls;
  if (!Array.isArray(rawCalls) || rawCalls.length === 0) {
    throw new Error(
      "manifest.capabilities.onchain.calls must be a non-empty array of { target, selector }",
    );
  }

  const seen = new Set<string>();
  const capabilities: Capability[] = rawCalls.map((entry, i) => {
    const where = `capabilities.onchain.calls[${i}]`;
    if (typeof entry !== "object" || entry === null) throw new Error(`${where} must be an object`);
    const e = entry as Record<string, unknown>;

    if (typeof e.target !== "string" || !isAddress(e.target)) {
      throw new Error(`${where}.target must be a 20-byte address`);
    }
    const target = getAddress(e.target);
    const { selector, label } = parseSelector(e.selector, where);

    // The registry rejects duplicates on chain; catching it here saves a failed
    // transaction and names the offending entry.
    const key = `${target.toLowerCase()}:${selector}`;
    if (seen.has(key)) throw new Error(`${where}: duplicate capability ${target} ${label}`);
    seen.add(key);

    return { target, selector, label };
  });

  return {
    schema: typeof m.schema === "string" ? m.schema : "lockstep/1",
    name,
    version,
    capabilities,
    maxValuePerCall: parseValue(oc.maxValuePerCall),
    versionId: computeVersionId(name, version),
  };
}

export async function loadManifest(skillDir: string, explicitPath?: string): Promise<Manifest> {
  const path = explicitPath ?? join(skillDir, MANIFEST_FILENAME);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(
      `no capability manifest at ${path}. Create a ${MANIFEST_FILENAME} declaring what this skill may call on chain.`,
    );
  }
  try {
    return parseManifest(JSON.parse(raw));
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

