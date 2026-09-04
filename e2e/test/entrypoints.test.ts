/**
 * Every declared entry point, executed by plain node.
 *
 * This suite exists because 302 passing tests coexisted with a CLI that could not start.
 * Vitest resolves a "./foo.js" specifier to foo.ts, and so does OpenClaw's loader, so
 * both were happy importing modules that node itself could never load. Nothing ever ran
 * the shipped entry points the way a user runs them, and `node cli/src/index.ts` failed
 * on its first import.
 *
 * So the check here is deliberately dumb: hand each entry point to node with no loader,
 * no bundler and no test runner, and see whether it starts. Two failure classes matter.
 *
 *   Module resolution. A specifier naming a file that is not on disk.
 *   Type stripping. Node erases types and refuses anything needing real codegen, so an
 *   enum or a constructor parameter property makes the whole file unloadable.
 *
 * Both are invisible to the rest of the suite and both break the product completely, so
 * they are worth a test that cannot be satisfied by mocking.
 *
 * The entry points are read from the package manifests rather than hardcoded, so a new
 * workspace or a new exports subpath is covered without anyone remembering to add it.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");

/** Errors that mean node could not load the file at all. */
const LOAD_FAILURES = [
  "ERR_MODULE_NOT_FOUND",
  "ERR_UNKNOWN_FILE_EXTENSION",
  "ERR_UNSUPPORTED_DIR_IMPORT",
  "ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING",
  // Amaro's refusal when a file needs codegen rather than type erasure.
  "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX",
  "Unsupported TypeScript syntax",
  "TypeStripError",
] as const;

interface Target {
  readonly label: string;
  readonly file: string;
  /**
   * True when importing the file runs a program rather than just defining exports.
   *
   * The contract differs. A library must import cleanly and exit 0. An executable parses
   * argv on import, so with no arguments the CLI prints usage and exits 1 -- correct
   * behaviour that says nothing about whether the module loaded. For those, loading is
   * the only thing this suite can fairly assert; `lockstep --help` covers exit codes.
   */
  readonly executable: boolean;
}

function manifest(pkgDir: string): Record<string, unknown> | undefined {
  const file = join(ROOT, pkgDir, "package.json");
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

/** Collects every local .ts path a package advertises through exports, main or bin. */
function entryPointsOf(pkgDir: string): Target[] {
  const pkg = manifest(pkgDir);
  if (pkg === undefined) return [];
  const name = typeof pkg.name === "string" ? pkg.name : pkgDir;
  const found: Target[] = [];

  // Anything listed under bin is a program, including when exports points at the same
  // file, which is how the CLI is wired.
  const binFiles = new Set<string>();
  if (pkg.bin !== null && typeof pkg.bin === "object") {
    for (const value of Object.values(pkg.bin as Record<string, unknown>)) {
      if (typeof value === "string" && value.startsWith(".")) {
        binFiles.add(resolve(ROOT, pkgDir, value));
      }
    }
  }

  const add = (subpath: string, value: unknown): void => {
    if (typeof value !== "string" || !value.startsWith(".")) return;
    const file = join(ROOT, pkgDir, value);
    if (!existsSync(file)) return;
    found.push({ label: `${name} ${subpath}`, file, executable: binFiles.has(resolve(file)) });
  };

  add("main", pkg.main);
  if (pkg.exports !== null && typeof pkg.exports === "object") {
    for (const [subpath, value] of Object.entries(pkg.exports as Record<string, unknown>)) {
      add(`exports ${subpath}`, value);
    }
  }
  if (pkg.bin !== null && typeof pkg.bin === "object") {
    for (const [cmd, value] of Object.entries(pkg.bin as Record<string, unknown>)) {
      add(`bin ${cmd}`, value);
    }
  }
  return found;
}

const workspaces = (() => {
  const root = manifest(".");
  const list = root?.workspaces;
  return Array.isArray(list) ? (list as string[]) : [];
})();

const targets = workspaces.flatMap(entryPointsOf);

interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly output: string;
}

/**
 * Runs node and waits without blocking.
 *
 * Deliberately async rather than spawnSync. Type stripping a whole dependency graph costs
 * seconds per start, and a synchronous wait holds the worker thread for that entire time,
 * which starves vitest's RPC heartbeat and ends the run with "Timeout calling
 * onTaskUpdate" -- an error that has nothing to do with the code under test but fails the
 * suite anyway.
 */
async function runNode(args: readonly string[]): Promise<RunResult> {
  return await new Promise<RunResult>((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [...args], { cwd: ROOT });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); rejectRun(error); });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolveRun({ status, stdout, output: `${stdout}\n${stderr}` });
    });
  });
}

/** Imports a file in a fresh node process, with no loader of any kind. */
async function importWithPlainNode(file: string): Promise<RunResult> {
  const url = pathToFileURL(file).href;
  return await runNode(["--input-type=module", "-e", `await import(${JSON.stringify(url)});`]);
}

function assertLoadable(label: string, output: string): void {
  for (const marker of LOAD_FAILURES) {
    if (output.includes(marker)) {
      throw new Error(
        `${label} cannot be loaded by plain node.\nMatched: ${marker}\n\n${output.trim()}`,
      );
    }
  }
}

describe("declared entry points load under plain node", () => {
  it("found entry points to check", () => {
    // Guards against the enumeration silently returning nothing, which would make every
    // test below vacuously pass. This is the same trap the invariant suite fell into.
    expect(workspaces.length).toBeGreaterThan(0);
    expect(targets.length).toBeGreaterThan(0);
  });

  for (const target of targets) {
    it(`loads ${target.label}`, async () => {
      const { status, output } = await importWithPlainNode(target.file);
      assertLoadable(target.label, output);
      if (target.executable) {
        // It reached its own code and produced output, which is the most that can be
        // claimed without inventing arguments for it.
        expect(output.trim().length, `${target.label} loaded but produced nothing`).toBeGreaterThan(0);
        return;
      }
      expect(status, `${target.label} exited ${status}\n${output.trim()}`).toBe(0);
    });
  }
});

describe("the CLI runs as a command", () => {
  it("prints usage and exits 0", async () => {
    const cli = join(ROOT, "cli", "src", "index.ts");
    const result = await runNode([cli, "--help"]);
    assertLoadable("cli --help", result.output);
    expect(result.status, result.output.trim()).toBe(0);
    // The commands a user is told about should actually be listed, so a stub that exits 0
    // without doing anything cannot satisfy this.
    for (const command of ["hash", "publish", "approve", "status", "diff"]) {
      expect(result.stdout).toContain(`lockstep ${command}`);
    }
  });

  it("hashes a real skill directory deterministically", async () => {
    const cli = join(ROOT, "cli", "src", "index.ts");
    const skill = join(ROOT, "demo", "skills", "kuru-quote");
    if (!existsSync(skill)) return;

    const run = async (): Promise<string> => {
      const result = await runNode([cli, "hash", skill]);
      assertLoadable("cli hash", result.output);
      expect(result.status, result.output.trim()).toBe(0);
      return result.stdout;
    };

    const first = await run();
    // A 32-byte hash has to appear, otherwise "exit 0" tells us nothing.
    const hash = /0x[0-9a-f]{64}/.exec(first)?.[0];
    expect(hash, `no skill hash in output:\n${first}`).toBeDefined();
    // Same bytes, same hash. Canonical hashing is the foundation the pin rests on, so a
    // second run disagreeing would invalidate every approval.
    expect(await run()).toContain(hash as string);
  });
});

describe("the live-dispatch harness parses", () => {
  it("is syntactically valid for the node that will run it", async () => {
    const script = join(ROOT, "scripts", "live-dispatch.mjs");
    if (!existsSync(script)) return;
    const result = await runNode(["--check", script]);
    expect(result.status, result.output.trim()).toBe(0);
  });
});
