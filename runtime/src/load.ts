/**
 * Reads a skill directory from disk into the flat file list `hashSkill` expects.
 *
 * Kept separate from `canonical.ts` so the hashing core stays pure and testable
 * without touching a filesystem. The CI action, the sandbox replay harness, and
 * the runtime wrapper all reuse the same core through different loaders.
 */

import { readdir, readFile, lstat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import {
  SkillHashError,
  canonicalisePath,
  isExcluded,
  type SkillFile,
} from "./canonical.ts";

export interface LoadOptions {
  /**
   * Symlinks are rejected by default.
   *
   * A symlink inside a skill can point anywhere on the host. If we followed it,
   * the pinned hash would cover content the publisher does not control and that
   * differs per machine - both a false-positive source and an escape hatch out of
   * the skill root. If we hashed the link path instead of the target, the pin
   * would say nothing about what actually executes. Neither is acceptable, so a
   * skill containing a symlink cannot be pinned.
   */
  readonly allowSymlinks?: boolean;
}

/**
 * Reports whether any execute bit is set.
 *
 * Windows filesystems do not carry this bit, so this returns false there for
 * every file. A skill containing an executable script therefore hashes
 * differently on Windows than on Linux. That is why publishing runs in CI on
 * Linux: the action is the sanctioned source of a pin, and a developer hashing
 * locally on Windows is doing so only for inspection.
 */
async function isExecutable(absolutePath: string): Promise<boolean> {
  const stat = await lstat(absolutePath);
  return (stat.mode & 0o111) !== 0;
}

/** Recursively collects files under `root`, skipping excluded top-level paths. */
export async function loadSkillFiles(
  root: string,
  options: LoadOptions = {},
): Promise<SkillFile[]> {
  const files: SkillFile[] = [];

  async function walk(dir: string): Promise<void> {
    const dirEntries = await readdir(dir, { withFileTypes: true });

    for (const dirEntry of dirEntries) {
      const absolute = join(dir, dirEntry.name);
      const relativeRaw = relative(root, absolute).split(sep).join("/");

      // Cheap early exit so we never descend into .git at all.
      if (isExcluded(canonicalisePath(relativeRaw))) continue;

      if (dirEntry.isSymbolicLink()) {
        if (options.allowSymlinks !== true) {
          throw new SkillHashError(
            `Symlink cannot be pinned: ${relativeRaw}`,
            "SYMLINK_REJECTED",
          );
        }
        // Even when explicitly allowed, resolve and treat as a plain file so the
        // hash covers real bytes rather than a link that may dangle elsewhere.
        const stat = await lstat(absolute);
        if (stat.isDirectory()) continue;
        files.push({
          path: relativeRaw,
          content: new Uint8Array(await readFile(absolute)),
        });
        continue;
      }

      if (dirEntry.isDirectory()) {
        await walk(absolute);
        continue;
      }

      if (dirEntry.isFile()) {
        files.push({
          path: relativeRaw,
          content: new Uint8Array(await readFile(absolute)),
          executable: await isExecutable(absolute),
        });
      }
      // Sockets, FIFOs, and devices are silently skipped: they have no stable
      // byte content and cannot legitimately appear in a distributable skill.
    }
  }

  await walk(root);
  return files;
}
