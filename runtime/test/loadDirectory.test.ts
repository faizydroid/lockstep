import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { hashSkill } from "../src/canonical.ts";
import { hashSkillDirectory } from "../src/hashDirectory.ts";
import { loadSkillFiles } from "../src/load.ts";

const FIXTURE = new URL("../fixtures/kuru-quote", import.meta.url).pathname
  // On Windows the pathname is prefixed with a leading slash before the drive.
  .replace(/^\/([A-Za-z]:)/, "$1");

const tempRoots: string[] = [];

async function tempSkill(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lockstep-"));
  tempRoots.push(root);
  return root;
}

afterAll(async () => {
  await Promise.all(
    tempRoots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("hashSkillDirectory", () => {
  it("hashes the fixture skill and finds every file", async () => {
    const result = await hashSkillDirectory(FIXTURE);

    expect(result.entries.map((e) => e.path)).toEqual([
      "lockstep.json",
      "scripts/quote.mjs",
      "skill.md",
    ]);
    expect(result.skillHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  /**
   * Golden vector. This value pins the hashing scheme itself.
   *
   * If this test fails and the fixture has not changed, the canonicalisation
   * policy changed - which invalidates every pin already published. That is a
   * breaking change and requires bumping SCHEME_ID, not updating this constant.
   */
  it("matches the published golden vector for lockstep-skill-hash/v2", async () => {
    const result = await hashSkillDirectory(FIXTURE);

    expect(result.scheme).toBe("lockstep-skill-hash/v2");
    expect(result.skillHash).toBe(
      "0x9c66b961fe093d92b35dfed90ec234d617fa4f77899c4871f4e734b1dd5b757b",
    );
  });

  it("produces the same hash through the directory loader and the pure core", async () => {
    const viaLoader = await hashSkillDirectory(FIXTURE);
    const viaCore = hashSkill(await loadSkillFiles(FIXTURE));

    expect(viaLoader.skillHash).toBe(viaCore.skillHash);
  });

  it("never descends into .git", async () => {
    const root = await tempSkill();
    await writeFile(join(root, "skill.md"), "# a\n");
    await mkdir(join(root, ".git", "objects"), { recursive: true });
    await writeFile(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");

    const files = await loadSkillFiles(root);

    expect(files.map((f) => f.path)).toEqual(["skill.md"]);
  });

  it("refuses to pin a skill containing a symlink", async () => {
    const root = await tempSkill();
    await writeFile(join(root, "skill.md"), "# a\n");

    try {
      await symlink(join(root, "skill.md"), join(root, "alias.md"));
    } catch {
      // Unprivileged Windows accounts cannot create symlinks. Skip rather than
      // assert a platform capability we do not control.
      return;
    }

    await expect(loadSkillFiles(root)).rejects.toThrow(/Symlink cannot be pinned/);
  });

  it("detects tampering with a nested script", async () => {
    const root = await tempSkill();
    await mkdir(join(root, "scripts"), { recursive: true });
    await writeFile(join(root, "skill.md"), "# a\n");
    await writeFile(join(root, "scripts", "run.mjs"), "export const x = 1;\n");

    const before = await hashSkillDirectory(root);

    await writeFile(
      join(root, "scripts", "run.mjs"),
      "export const x = 1;\nfetch('https://evil.example');\n",
    );

    const after = await hashSkillDirectory(root);

    expect(after.skillHash).not.toBe(before.skillHash);
  });
});
