/**
 * Tracks which skill produced a transaction, per agent run.
 *
 * OpenClaw loads skills lazily: the system prompt carries only a condensed list
 * of names, descriptions, and file locations, and the model calls the `read` tool
 * on a `SKILL.md` when it decides to use one. So the set of skills whose
 * instructions are actually in context for a run is exactly the set of `SKILL.md`
 * files read during it.
 *
 * That observation is the whole provenance mechanism. We do not ask the agent
 * which skill it is acting on, and we do not accept an answer if it offers one.
 */

import { homedir } from "node:os";
import { dirname, resolve, sep } from "node:path";

/**
 * Expands a leading `~` to the home directory.
 *
 * Models pass tilde paths to the read tool, and the host accepts them: an observed read was
 * `~/AppData/Local/Temp/.../skills/kuru-quote/SKILL.md`. `resolve` gives `~` no special
 * meaning, so it becomes a literal directory name under the current working directory. The
 * result still ends in SKILL.md and still looks like a skill manifest, but it points somewhere
 * that does not exist and sits under no configured skill root, so provenance is rejected for a
 * read that genuinely happened. Fixing it here keeps every later comparison working on real
 * paths.
 */
export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) return resolve(homedir(), path.slice(2));
  return path;
}

/** A `SKILL.md` read observed during one run. */
export interface SkillRead {
  /** Absolute path to the SKILL.md that was read. */
  readonly skillMdPath: string;
  /** Monotonic order of observation within the run. */
  readonly seq: number;
}

export type ProvenanceOutcome =
  | { readonly kind: "resolved"; readonly skillRoot: string }
  /** No skill instructions were in context, so nothing vouches for this call. */
  | { readonly kind: "no-skill" }
  /**
   * More than one skill was in context. Any of them could have influenced the
   * call, so attributing it to one would be a guess presented as a fact.
   */
  | { readonly kind: "ambiguous"; readonly skillRoots: readonly string[] };

const SKILL_MANIFEST = "skill.md";

/** True when a read path is a skill manifest. OpenClaw uses uppercase SKILL.md. */
export function isSkillManifest(path: string): boolean {
  const normalised = path.replace(/\\/g, "/");
  const base = normalised.slice(normalised.lastIndexOf("/") + 1);
  return base.toLowerCase() === SKILL_MANIFEST;
}

/**
 * The skill root is the directory holding SKILL.md.
 *
 * OpenClaw discovers a skill wherever a SKILL.md appears under a configured
 * root, up to six levels deep, and the enclosing folder path is organisational
 * only. So the manifest's own directory is the skill, regardless of nesting.
 */
export function skillRootOf(skillMdPath: string): string {
  return dirname(resolve(skillMdPath));
}

/**
 * Record of observed skill reads, grouped by a correlation id the caller supplies.
 *
 * Provenance must not leak from a previous turn into the current one: an agent that read a
 * pinned skill an hour ago must not inherit its authority now. Keying by run id would say
 * that directly, and that is what this did at first, but the run id is not available on both
 * sides of the correlation. The host gives hooks a runId and gives a tool factory a
 * sessionId, with no overlap (tool context keys verified against openclaw@2026.8.2:
 * config, runtimeConfig, getRuntimeConfig, fsPolicy, workspaceDir, agentDir, agentId,
 * sessionKey, sessionId, toolBindings, ... and no run identifier among them). A key only one
 * side can compute is not a key.
 *
 * So the caller correlates on session, and the per-turn lifetime is preserved by clearing on
 * `agent_end`, which fires per run. The window is therefore still first-read-to-end-of-run
 * rather than the life of the conversation.
 *
 * Two runs sharing a session concurrently would land in the same bucket. That is not a hole:
 * reads from both appear together, `resolve` reports more than one skill as ambiguous, and
 * ambiguity blocks. The failure mode is a refused transaction, not a borrowed approval.
 */
export class SkillProvenanceTracker {
  private readonly byRun = new Map<string, Map<string, SkillRead>>();
  private seq = 0;

  /** Records a successful `read`. Non-manifest paths are ignored. */
  observeRead(correlationId: string, rawPath: string): void {
    if (!isSkillManifest(rawPath)) return;

    const path = expandHome(rawPath);
    const root = skillRootOf(path);
    let reads = this.byRun.get(correlationId);
    if (reads === undefined) {
      reads = new Map();
      this.byRun.set(correlationId, reads);
    }
    // Re-reading the same manifest is not a second skill.
    if (!reads.has(root)) {
      this.seq += 1;
      reads.set(root, { skillMdPath: resolve(path), seq: this.seq });
    }
  }

  /** Resolves provenance for a correlation id, failing closed on absence or ambiguity. */
  resolve(correlationId: string): ProvenanceOutcome {
    const reads = this.byRun.get(correlationId);
    if (reads === undefined || reads.size === 0) {
      return { kind: "no-skill" };
    }
    if (reads.size > 1) {
      const roots = [...reads.entries()]
        .sort((a, b) => a[1].seq - b[1].seq)
        .map(([root]) => root);
      return { kind: "ambiguous", skillRoots: roots };
    }
    const [root] = [...reads.keys()];
    return { kind: "resolved", skillRoot: root! };
  }

  /**
   * Drops a record.
   *
   * Must be called on `agent_end`. Without it a long-lived Gateway accumulates one entry per
   * turn forever, and provenance from a finished run stays available to anything that can
   * guess its id. This is also what keeps the correlation window down to a single turn even
   * though the key is a session.
   */
  forget(correlationId: string): void {
    this.byRun.delete(correlationId);
  }

  /** Number of tracked correlation ids. Exposed for leak assertions in tests. */
  get trackedRuns(): number {
    return this.byRun.size;
  }
}

/**
 * True when `candidate` is inside `root`.
 *
 * Compared on resolved paths with a trailing separator so `/skills/kuru` does not
 * match `/skills/kuru-evil`. Used to confirm a resolved skill root actually lives
 * under a configured skills directory before trusting it.
 */
export function isInside(root: string, candidate: string): boolean {
  const a = resolve(root);
  const b = resolve(candidate);
  if (a === b) return true;
  return b.startsWith(a.endsWith(sep) ? a : a + sep);
}
