/**
 * The decision: may this transaction proceed, and under whose provenance?
 *
 * Pure, with every dependency injected, so the security properties can be tested
 * without a Gateway, a filesystem, or a chain. Everything in `index.ts` is wiring
 * around this function.
 *
 * Fails closed on every path. There is no branch that allows a call because
 * something could not be determined.
 */

import type { ProvenanceOutcome } from "./activeSkill.ts";

/** A pin the account holder has approved, indexed by the skill hash it covers. */
export interface ApprovedPin {
  readonly pinId: `0x${string}`;
  readonly skillHash: `0x${string}`;
  readonly publisher: `0x${string}`;
}

export interface PolicyDeps {
  /** Hashes a skill directory from disk. Never supplied by the agent. */
  readonly hashSkillDirectory: (root: string) => Promise<`0x${string}`>;
  /** Approved pin covering a skill hash, or undefined if none is approved. */
  readonly findApprovedPin: (skillHash: `0x${string}`) => Promise<ApprovedPin | undefined>;
  /** Configured skills roots. A resolved skill must live under one of them. */
  readonly skillRoots: readonly string[];
  /** Containment check, injected so tests can exercise it directly. */
  readonly isInside: (root: string, candidate: string) => boolean;
}

export type Decision =
  | {
      readonly kind: "allow";
      readonly pinId: `0x${string}`;
      /** Computed here, from disk. Never echoed from agent input. */
      readonly skillHash: `0x${string}`;
      readonly skillRoot: string;
    }
  | {
      readonly kind: "block";
      readonly code: BlockCode;
      /** Safe to surface to the model and the user. Contains no secrets. */
      readonly reason: string;
    };

export type BlockCode =
  | "NO_SKILL_PROVENANCE"
  | "AMBIGUOUS_PROVENANCE"
  | "SKILL_OUTSIDE_ROOTS"
  | "HASH_FAILED"
  | "SKILL_CHANGED"
  | "NOT_PINNED";

/**
 * Decides whether a transaction may proceed.
 *
 * Note what is absent from the signature: nothing the agent says. The caller
 * passes a run id and the tracker resolves provenance from observed reads. There
 * is no parameter through which a model could name a skill, supply a hash, or
 * select a pin.
 */
export async function decide(
  provenance: ProvenanceOutcome,
  deps: PolicyDeps,
): Promise<Decision> {
  if (provenance.kind === "no-skill") {
    return {
      kind: "block",
      code: "NO_SKILL_PROVENANCE",
      reason:
        "No skill instructions are in context for this run, so nothing vouches for this transaction. Read the SKILL.md of a pinned skill before moving funds.",
    };
  }

  if (provenance.kind === "ambiguous") {
    return {
      kind: "block",
      code: "AMBIGUOUS_PROVENANCE",
      reason:
        `${provenance.skillRoots.length} skills are in context for this run, so this transaction cannot be attributed to one of them. Start a new run and use a single skill.`,
    };
  }

  const { skillRoot } = provenance;

  // A skill root outside every configured root is not a skill OpenClaw loaded.
  // Reaching this state means either a path-handling bug or an attempt to point
  // provenance at attacker-controlled files, and neither should proceed.
  if (!deps.skillRoots.some((root) => deps.isInside(root, skillRoot))) {
    return {
      kind: "block",
      code: "SKILL_OUTSIDE_ROOTS",
      reason: "The active skill is not inside a configured skills root.",
    };
  }

  let skillHash: `0x${string}`;
  try {
    skillHash = await deps.hashSkillDirectory(skillRoot);
  } catch {
    // A skill that cannot be hashed cannot be pinned. Unreadable files, a
    // symlink, or a mid-run mutation all land here, and all mean the same thing:
    // we do not know what is about to run.
    return {
      kind: "block",
      code: "HASH_FAILED",
      reason: "The active skill could not be hashed, so its version is unknown.",
    };
  }

  // The bytes the agent was shown have to be the bytes being attested.
  //
  // The directory used to be hashed only here, at send time. A skill that was hostile when its manifest
  // was read, and had the approved bytes put back before the send, was attested as the approved version:
  // the instructions that shaped the calls came from one set of files and the hash from another. Every
  // hash taken at a read of this skill must equal the one taken now. A failed read-time hash (null) and a
  // missing one (empty) both block, because "we did not look" is not "it matched".
  if (provenance.readHashes !== undefined) {
    const sameBytes =
      provenance.readHashes.length > 0 &&
      provenance.readHashes.every((h) => h !== null && h.toLowerCase() === skillHash.toLowerCase());
    if (!sameBytes) {
      return {
        kind: "block",
        code: "SKILL_CHANGED",
        reason:
          "The skill's files are not the ones the agent read: they changed between reading the skill and sending. Start a new run so the skill is read again as it is now.",
      };
    }
  }

  const pin = await deps.findApprovedPin(skillHash);
  if (pin === undefined) {
    return {
      kind: "block",
      code: "NOT_PINNED",
      reason:
        `This exact version of the skill is not one you approved (${skillHash.slice(0, 10)}...). If the publisher shipped an update, review the capability diff and approve it before it can move funds.`,
    };
  }

  return { kind: "allow", pinId: pin.pinId, skillHash, skillRoot };
}
