/**
 * `lockstep diff` - what changed between the version you approved and what is on disk.
 */

import { formatUnits, type PublicClient } from "viem";

import { hashSkillDirectory } from "@lockstep/runtime";

import { publicClientFor, resolveEnv, type Env } from "../env.ts";
import {
  diffCapabilities,
  findPinsForSkillHash,
  formatCapability,
  loadApprovedPinIds,
  loadPin,
  type PinSummary,
} from "../pins.ts";

export interface DiffOptions {
  readonly skillDir: string | undefined;
}

/** Shared by `diff` and `approve` so both describe a change identically. */
export async function resolveChange(
  client: PublicClient,
  env: Env,
  skillDir: string,
): Promise<{
  readonly onDiskHash: `0x${string}`;
  readonly candidate: PinSummary | undefined;
  readonly approved: PinSummary | undefined;
}> {
  const hashed = await hashSkillDirectory(skillDir);
  const candidates = await findPinsForSkillHash(client, env.registry, hashed.skillHash);
  // Live pins first: a publisher may have republished after revoking.
  const candidate = candidates.find((p) => !p.revoked) ?? candidates[0];

  const approvedIds = await loadApprovedPinIds(client, env.account);
  let approved: PinSummary | undefined;
  for (const pinId of approvedIds) {
    const pin = await loadPin(client, env.registry, pinId);
    if (pin === undefined) continue;
    // An approval for a different skill is irrelevant; match on publisher so the
    // comparison is "the same publisher's previous version".
    if (candidate !== undefined && pin.publisher === candidate.publisher) {
      approved = pin;
      break;
    }
    if (candidate === undefined) approved ??= pin;
  }

  return { onDiskHash: hashed.skillHash, candidate, approved };
}

export function printDiff(approved: PinSummary | undefined, candidate: PinSummary): boolean {
  if (approved === undefined) {
    process.stdout.write("no prior approval from this publisher: this is a first approval\n\n");
    process.stdout.write(`capabilities requested (${candidate.capabilities.length})\n`);
    for (const c of candidate.capabilities) process.stdout.write(`  + ${formatCapability(c)}\n`);
    if (candidate.maxValuePerCall > 0n) {
      process.stdout.write(
        `  + native value up to ${formatUnits(candidate.maxValuePerCall, 18)} MON per call\n`,
      );
    }
    return true;
  }

  if (approved.skillHash === candidate.skillHash) {
    process.stdout.write("already approved: this exact version is pinned and approved\n");
    return false;
  }

  const diff = diffCapabilities(approved, candidate);

  process.stdout.write(`approved version  ${approved.skillHash}\n`);
  process.stdout.write(`version on disk   ${candidate.skillHash}\n\n`);

  if (!diff.widened) {
    process.stdout.write(
      "code changed, capabilities did not widen.\n" +
        "This is the auto-approvable case: nothing new can be reached.\n\n",
    );
  }

  for (const c of diff.added) process.stdout.write(`  + ${formatCapability(c)}\n`);
  for (const c of diff.removed) process.stdout.write(`  - ${formatCapability(c)}\n`);
  for (const c of diff.unchanged) process.stdout.write(`    ${formatCapability(c)}\n`);

  if (diff.valueCeilingAfter !== diff.valueCeilingBefore) {
    const direction = diff.valueCeilingAfter > diff.valueCeilingBefore ? "+" : "-";
    process.stdout.write(
      `  ${direction} native value ceiling ${formatUnits(diff.valueCeilingBefore, 18)} -> ${formatUnits(diff.valueCeilingAfter, 18)} MON\n`,
    );
  }

  if (diff.widened) {
    process.stdout.write(
      "\nThis version can do things the approved one could not. Read the additions above.\n",
    );
  }
  return diff.widened;
}

export async function diffCommand(options: DiffOptions): Promise<number> {
  const { skillDir } = options;
  if (skillDir === undefined) {
    process.stderr.write("lockstep diff: a skill directory is required\n");
    return 2;
  }

  const env = resolveEnv();
  const client = publicClientFor(env);
  const { onDiskHash, candidate, approved } = await resolveChange(client, env, skillDir);

  process.stdout.write(`directory   ${skillDir}\n`);
  process.stdout.write(`skillHash   ${onDiskHash}\n\n`);

  if (candidate === undefined) {
    process.stdout.write(
      "no pin exists for these bytes.\n" +
        "The publisher has not pinned this version, so it can never move funds.\n",
    );
    return 1;
  }

  if (candidate.revoked) {
    process.stdout.write("WARNING: the publisher has revoked this version.\n\n");
  }

  printDiff(approved, candidate);
  return 0;
}
