import { hashSkill, type SkillHashResult } from "./canonical.ts";
import { loadSkillFiles, type LoadOptions } from "./load.ts";

/** Convenience wrapper: read a skill directory and return its canonical hash. */
export async function hashSkillDirectory(
  root: string,
  options: LoadOptions = {},
): Promise<SkillHashResult> {
  return hashSkill(await loadSkillFiles(root, options));
}
