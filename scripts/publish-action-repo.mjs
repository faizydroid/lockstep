/**
 * Publishes `action/` to a standalone repository, which is the only way to list it on the
 * GitHub Marketplace.
 *
 *   node scripts/publish-action-repo.mjs --dry-run
 *   node scripts/publish-action-repo.mjs --version v0.1.0
 *
 * ## Why a second repository is unavoidable
 *
 * The Marketplace has two hard requirements: a repository may contain exactly one action, and the
 * action's metadata file must sit in the repository *root*. This is a monorepo with contracts, a
 * dashboard, a CLI, a watcher and an indexer in it, and the metadata is at `action/action.yml`. So
 * the listing cannot be created from here, and no amount of configuration changes that.
 *
 * Worth being precise about what is and is not blocked, because the README previously gave the
 * wrong reason. **The action is fully usable from this repository today** — `uses:` accepts a
 * subdirectory, so `faizydroid/lockstep/action@v0.1.0` works and needs nothing from the
 * Marketplace. What a listing adds is discovery: a searchable page. That is worth having and it is
 * not worth restructuring a monorepo for.
 *
 * ## Why a script and not a workflow
 *
 * Pushing to a second repository from CI needs a personal access token stored as a secret, with
 * write access to a repo outside this one. That is a broad, long-lived credential to create for a
 * job that runs when a human decides to cut a release. This runs locally against the `gh` auth the
 * maintainer already has, so no new secret exists to leak.
 *
 * ## What it does
 *
 * Builds a clean tree — `action.yml`, the bundled `dist/`, a README and the licence — and pushes it
 * as a single commit to the target repository, then tags it. Nothing else from the monorepo goes
 * across, because the Marketplace check rejects a repository that contains a second action, and
 * because a publisher auditing what they are running should not have to read past a dashboard.
 *
 * The bundle is committed deliberately. A published action is fetched and executed without an
 * install step, so `dist/index.js` has to be in the tree. That is the one place in this project
 * where a build artifact belongs in version control.
 */

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ACTION = join(ROOT, "action");

const TARGET_REPO = "faizydroid/lockstep-action";
const SOURCE_REPO = "faizydroid/lockstep";

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 || process.argv[at + 1] === undefined ? fallback : process.argv[at + 1];
}
const DRY_RUN = process.argv.includes("--dry-run");
const VERSION = arg("version", "v0.1.0");

function run(command, args, options = {}) {
  process.stdout.write(`$ ${command} ${args.join(" ")}\n`);
  if (DRY_RUN && options.mutates) {
    process.stdout.write("  (dry run, skipped)\n");
    return "";
  }
  return execFileSync(command, args, { encoding: "utf8", stdio: "pipe", ...options }).trim();
}

/*
 * The bundle has to be current, or the published action runs code nobody reviewed.
 *
 * `shell: true` on Windows, and the reason is worth writing down because Node prints a security
 * warning about it and the warning is correct in general.
 *
 * Windows needs a shell here and there is no way around it: npm is `npm.cmd`, and since the fix for
 * CVE-2024-27980 Node refuses to `spawnSync` a `.cmd` file without one — it fails with `EINVAL`.
 * Naming the executable explicitly was tried first and is what produces that error.
 *
 * What the warning describes is that arguments passed through a shell are concatenated rather than
 * escaped, so an attacker-controlled argument becomes an attacker-controlled command. That hazard
 * needs untrusted input, and there is none: every argument below is a literal in this file. Nothing
 * from `process.argv`, the environment, or the repository reaches this call. `--version` is used
 * only in a git tag and a template string.
 */
const npmOptions = { cwd: ROOT, ...(process.platform === "win32" ? { shell: true } : {}) };
run("npm", ["run", "build", "--workspace", "@lockstep/action"], npmOptions);

const sha = run("git", ["rev-parse", "HEAD"], { cwd: ROOT });
const staging = mkdtempSync(join(tmpdir(), "lockstep-action-"));
process.stdout.write(`staging in ${staging}\n`);

cpSync(join(ACTION, "action.yml"), join(staging, "action.yml"));
cpSync(join(ACTION, "dist"), join(staging, "dist"), { recursive: true });
cpSync(join(ROOT, "LICENSE"), join(staging, "LICENSE"));

/*
 * A README written for the person deciding whether to run this in their pipeline, rather than a
 * copy of the monorepo's. It states what the action refuses to do, because the refusals are the
 * product and a publisher needs to know a red check is the action working.
 */
const version = VERSION;
writeFileSync(
  join(staging, "README.md"),
  `# Lockstep Pin

Hash a skill, publish its pin, and bind that exact byte set to a version so a silent update cannot
inherit an approval a user already gave.

Built for [Monad](https://monad.xyz). Source, contracts and tests live in
[${SOURCE_REPO}](https://github.com/${SOURCE_REPO}) — this repository is the packaged action, and is
generated from \`action/\` there by \`scripts/publish-action-repo.mjs\`.

Generated from commit \`${sha}\`.

## Usage

\`\`\`yaml
- uses: ${TARGET_REPO}@${version}
  with:
    skill-dir: skills/my-skill
    pin-registry: \${{ vars.PIN_REGISTRY }}
    publisher-private-key: \${{ secrets.PUBLISHER_PRIVATE_KEY }}
\`\`\`

On a pull request, set \`dry-run: true\` and omit the key. The job then prices the pin and prints the
capability diff without publishing, which is what makes a widened manifest visible in review.

## The two refusals

Both are the point of the action, so treat a red check here as the tool doing its job.

**It will not publish a second conflicting claim about one version.** Publishing different bytes
under a name and version you already published is provable equivocation: two signed statements that
one release is two different byte sets. Anyone can then take your bond. The overwhelmingly likely
cause is a forgotten version bump, so the action stops rather than asking.

**It fails the job when a manifest widens capability.** A new \`(target, selector)\` pair, or a higher
native-value ceiling, means every user must approve again. That should be a decision, not a
side effect of a release. Set \`fail-on-capability-change: false\` to allow it deliberately.

## Inputs

See [\`action.yml\`](action.yml). \`skill-dir\` and \`pin-registry\` are required;
\`publisher-private-key\` is required unless \`dry-run\` is true.

## Licence

MIT.
`,
  "utf8",
);

run("git", ["init", "-q", "-b", "main"], { cwd: staging, mutates: true });
run("git", ["add", "."], { cwd: staging, mutates: true });
run("git", ["commit", "-q", "-m", `release ${version} (from ${SOURCE_REPO}@${sha.slice(0, 7)})`], {
  cwd: staging,
  mutates: true,
});
run("git", ["tag", version], { cwd: staging, mutates: true });

/*
 * A force push, and it is safe here for a reason worth stating rather than assuming: this
 * repository has no history worth keeping. It is a generated snapshot of one directory, the
 * monorepo is the source of truth, and every published version is pinned by tag. Tags are pushed
 * without force, so a released version can never be moved under a consumer.
 */
run("git", ["remote", "add", "origin", `https://github.com/${TARGET_REPO}.git`], {
  cwd: staging,
  mutates: true,
});
run("git", ["push", "--force", "origin", "main"], { cwd: staging, mutates: true });
run("git", ["push", "origin", version], { cwd: staging, mutates: true });

process.stdout.write(
  [
    "",
    DRY_RUN ? "dry run complete, nothing was pushed" : `pushed ${version} to ${TARGET_REPO}`,
    "",
    "Next, and only a human can do it:",
    `  1. https://github.com/${TARGET_REPO}/releases -> draft a release from tag ${version}`,
    "  2. Tick 'Publish this Action to the GitHub Marketplace' and accept the terms",
    "  3. Publish",
    "",
    `The action already works without any of that, as ${SOURCE_REPO}/action@${version}.`,
    "The listing is discovery only.",
    "",
  ].join("\n"),
);

rmSync(staging, { recursive: true, force: true });
