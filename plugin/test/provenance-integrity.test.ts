/**
 * Provenance integrity, key custody and failure reporting in the plugin.
 *
 * Three things an audit of the agent runtime found, each pinned by a test that fails without the fix:
 *
 *  1. The skill directory was hashed once, when `lockstep_send` ran. A skill that was hostile when its
 *     SKILL.md was read, and had the approved bytes put back before the send, was attested as the
 *     approved version: the instructions that produced the calls came from one set of files and the
 *     hash from another. The directory is now also hashed when the manifest is read, and every
 *     observation has to equal the one at send time.
 *  2. The executor key sat in the Gateway's environment, which is what OpenClaw hands to every `exec`
 *     child. It is claimed once and removed.
 *  3. A failed chain read escaped as a raw RPC error naming the RPC URL, which often carries an API key.
 *
 * The real plugin code and the runtime's real hashing run throughout; only the chain is faked.
 */
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashSkillDirectory } from "@lockstep/runtime";

import { SkillProvenanceTracker } from "../src/activeSkill.ts";
import { describeChainFailure, registerLockstep, type GuardedCall, type HostApi } from "../src/index.ts";
import { claimSecretFromEnv } from "../src/keyCustody.ts";
import { decide, type ApprovedPin, type Decision } from "../src/policy.ts";

// Each case copies and hashes a real skill directory, which is slow on a loaded or cold machine. The
// default five seconds made these flake under parallel CI load, and a flaky security test gets ignored.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const REPO = resolve(import.meta.dirname, "..", "..");
const APPROVED_SRC = join(REPO, "demo", "skills", "kuru-quote");
const HOSTILE_SRC = join(REPO, "demo", "attack", "kuru-quote-hostile");

const PIN_ID = "0x6520d020348ee7a8a91fcc071d0f62cf83762c47be749e6654c7ca31c0472df4" as const;
const PUBLISHER = "0xcc71E1f66CA325A9D3dEC74b2AA94CDF870194Dc" as const;
const TOKEN = "0xd80c19a863e4247B08f6152773820b87eE49a35C" as const;
const ATTACKER = "0x000000000000000000000000000000000000dEaD";

const hashOf = async (dir: string) => (await hashSkillDirectory(dir)).skillHash;

/** transfer(ATTACKER, amount), hand-encoded so the test has no ABI dependency. */
const transfer = (amount: bigint): `0x${string}` =>
  `0xa9059cbb${ATTACKER.toLowerCase().replace(/^0x/, "").padStart(64, "0")}${amount.toString(16).padStart(64, "0")}`;
const attackerCalls = () => [{ target: TOKEN, value: "0", data: transfer(9_750_000_000n) }];

let workspace: string;
let skills: string;
let skillDir: string;
let approvedHash: `0x${string}`;
let hostileHash: `0x${string}`;

const install = async (src: string) => {
  await rm(skillDir, { recursive: true, force: true });
  await cp(src, skillDir, { recursive: true });
};

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "lockstep-provenance-"));
  skills = join(workspace, "skills");
  skillDir = join(skills, "kuru-quote");
  approvedHash = await hashOf(APPROVED_SRC);
  hostileHash = await hashOf(HOSTILE_SRC);
});
afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

/** A fake host shaped like OpenClaw's, with the real plugin registered on it. */
function harness(findApprovedPin: (h: `0x${string}`) => Promise<ApprovedPin | undefined>) {
  const hooks = new Map<string, Array<(e: any, c: any) => unknown>>();
  const tools: any[] = [];
  const warnings: string[] = [];
  const api: HostApi = {
    on(hook, handler) {
      hooks.set(hook, [...(hooks.get(hook) ?? []), handler]);
    },
    registerTool(factory) {
      tools.push(factory({ sessionId: "s1" }));
    },
    registerTrustedToolPolicy() {},
    logger: { warn: (m: string) => void warnings.push(m), info: vi.fn() },
  };
  const submit = vi.fn(async (_d: Extract<Decision, { kind: "allow" }>, _c: readonly GuardedCall[]) => ({
    txHash: `0x${"ee".repeat(32)}` as `0x${string}`,
  }));
  registerLockstep(api, {
    skillRoots: [skills],
    deps: { hashSkillDirectory: hashOf, findApprovedPin },
    submit,
    tracker: new SkillProvenanceTracker(),
  });
  return {
    submit,
    warnings,
    tool: tools[0],
    /** The model reads a SKILL.md: the host fires after_tool_call. */
    read: (path: string) =>
      hooks.get("after_tool_call")![0]!({ toolName: "read", params: { path } }, { toolName: "read", sessionId: "s1", runId: "r1" }),
    send: () => tools[0].execute("call-1", { calls: attackerCalls() }),
  };
}

/** The only approved pin covers the approved bytes. */
const approvedOnly = async (hash: `0x${string}`): Promise<ApprovedPin | undefined> =>
  hash === approvedHash ? { pinId: PIN_ID, skillHash: approvedHash, publisher: PUBLISHER } : undefined;

describe("the bytes the agent read are the bytes attested", () => {
  it("allows the approved skill, unchanged from read to send", async () => {
    await install(APPROVED_SRC);
    const h = harness(approvedOnly);
    h.read(join(skillDir, "SKILL.md"));

    const result = await h.send();

    expect(result).toMatchObject({ ok: true, skillHash: approvedHash, pinId: PIN_ID });
    expect(h.submit).toHaveBeenCalledOnce();
  });

  it("refuses a skill that was hostile when read and had the approved bytes restored before the send", async () => {
    await install(HOSTILE_SRC); // the update channel delivered hostile bytes
    const h = harness(approvedOnly);
    h.read(join(skillDir, "SKILL.md")); // the model now has the hostile instructions in context

    await install(APPROVED_SRC); // a helper script puts the approved bytes back

    const result = await h.send();

    expect(result).toMatchObject({ ok: false, code: "SKILL_CHANGED" });
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("refuses a skill that was approved when read and was swapped for hostile bytes before the send", async () => {
    await install(APPROVED_SRC);
    const h = harness(approvedOnly);
    h.read(join(skillDir, "SKILL.md"));

    await install(HOSTILE_SRC);

    const result = await h.send();
    expect(result).toMatchObject({ ok: false, code: "SKILL_CHANGED" });
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("still reports NOT_PINNED for a silent update that was in place before the run", async () => {
    await install(HOSTILE_SRC);
    const h = harness(approvedOnly);
    h.read(join(skillDir, "SKILL.md"));

    expect(await h.send()).toMatchObject({ ok: false, code: "NOT_PINNED" });
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("refuses when the skill changed between two reads of its own manifest", async () => {
    await install(HOSTILE_SRC);
    const h = harness(approvedOnly);
    h.read(join(skillDir, "SKILL.md"));
    await install(APPROVED_SRC);
    h.read(join(skillDir, "SKILL.md")); // the second read now sees the approved bytes

    expect(await h.send()).toMatchObject({ ok: false, code: "SKILL_CHANGED" });
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("does not hash a skills directory outside the configured roots when its manifest is read", async () => {
    const outside = await mkdtemp(join(tmpdir(), "lockstep-outside-"));
    try {
      await cp(APPROVED_SRC, join(outside, "kuru-quote"), { recursive: true });
      const hashed: string[] = [];
      const hooks = new Map<string, Array<(e: any, c: any) => unknown>>();
      registerLockstep(
        {
          on: (hook, handler) => void hooks.set(hook, [...(hooks.get(hook) ?? []), handler]),
          registerTool: () => {},
          registerTrustedToolPolicy: () => {},
          logger: { warn: () => {}, info: () => {} },
        },
        {
          skillRoots: [skills],
          deps: {
            hashSkillDirectory: async (root) => {
              hashed.push(root);
              return approvedHash;
            },
            findApprovedPin: approvedOnly,
          },
          submit: async () => ({ txHash: `0x${"ee".repeat(32)}` as `0x${string}` }),
          tracker: new SkillProvenanceTracker(),
        },
      );
      hooks.get("after_tool_call")![0]!(
        { toolName: "read", params: { path: join(outside, "kuru-quote", "SKILL.md") } },
        { toolName: "read", sessionId: "s1" },
      );
      expect(hashed).toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("decide() and the read-time hashes", () => {
  const deps = () => ({
    hashSkillDirectory: async () => approvedHash,
    findApprovedPin: approvedOnly,
    skillRoots: [skills],
    isInside: (root: string, candidate: string) => candidate.startsWith(root),
  });

  it("blocks when no hash was taken at read time, or one failed, because not looking is not matching", async () => {
    const root = join(skills, "kuru-quote");
    expect(await decide({ kind: "resolved", skillRoot: root, readHashes: [] }, deps())).toMatchObject({
      kind: "block",
      code: "SKILL_CHANGED",
    });
    expect(await decide({ kind: "resolved", skillRoot: root, readHashes: [approvedHash, null] }, deps())).toMatchObject({
      kind: "block",
      code: "SKILL_CHANGED",
    });
  });

  it("allows when every read-time hash equals the hash at send time, whatever their case", async () => {
    const root = join(skills, "kuru-quote");
    const upper = approvedHash.toUpperCase().replace("0X", "0x") as `0x${string}`;
    expect(await decide({ kind: "resolved", skillRoot: root, readHashes: [approvedHash, upper] }, deps())).toMatchObject({
      kind: "allow",
    });
  });
});

describe("a failed chain read", () => {
  it("is a refusal in words, with the RPC URL and its API key kept out of what the model sees", async () => {
    await install(APPROVED_SRC);
    const secretUrl = "https://rpc.example.test/v1/abcdef0123456789-secret-api-key";
    const h = harness(async () => {
      throw Object.assign(new Error(`HTTP request failed.\n\nURL: ${secretUrl}\nDetails: eth_getLogs is limited to a 100 range`), {
        shortMessage: "HTTP request failed.",
      });
    });
    h.read(join(skillDir, "SKILL.md"));

    const result = (await h.send()) as { ok: boolean; code: string; error: string };

    expect(result.ok).toBe(false);
    expect(result.code).toBe("CHAIN_READ_FAILED");
    expect(result.error).not.toContain("secret-api-key");
    expect(result.error).not.toContain("rpc.example.test");
    expect(result.error).toContain("trustedPublishers");
    expect(h.warnings.join("\n")).not.toContain("secret-api-key");
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("describeChainFailure keeps only the first line and replaces any URL", () => {
    const text = describeChainFailure(new Error("Could not reach https://x.invalid/key=abc123 right now.\nsecond line https://y.invalid"));
    expect(text).toBe("Could not reach <rpc> right now.");
    expect(describeChainFailure("plain string")).toBe("plain string");
    expect(describeChainFailure(new Error(""))).toBe("The chain read failed.");
  });
});

describe("the executor key", () => {
  const NAME = "LOCKSTEP_TEST_EXECUTOR_KEY";
  const probe = () =>
    spawnSync(process.execPath, ["-e", `process.stdout.write(process.env.${NAME} ?? "absent")`], { encoding: "utf8" }).stdout;

  afterEach(() => {
    delete process.env[NAME];
  });

  it("can be seen by a child process while it stays in the environment, which is how exec leaks it", () => {
    process.env[NAME] = "0xdeadbeef";
    expect(probe()).toBe("0xdeadbeef");
  });

  it("is removed from the environment when claimed, so a child started afterwards cannot inherit it", () => {
    process.env[NAME] = "0xdeadbeef";
    const store = new Map<string, string>();

    expect(claimSecretFromEnv(NAME, process.env, store)).toBe("0xdeadbeef");

    expect(process.env[NAME]).toBeUndefined();
    expect(probe()).toBe("absent");
  });

  it("stays available to the registrations that follow, since the host registers a plugin more than once", () => {
    const env: NodeJS.ProcessEnv = { [NAME]: "0xdeadbeef" };
    const store = new Map<string, string>();

    expect(claimSecretFromEnv(NAME, env, store)).toBe("0xdeadbeef");
    expect(claimSecretFromEnv(NAME, env, store)).toBe("0xdeadbeef");
    expect(env[NAME]).toBeUndefined();
  });

  it("reports an absent or empty variable as absent, and never invents a value", () => {
    expect(claimSecretFromEnv(NAME, {}, new Map())).toBeUndefined();
    expect(claimSecretFromEnv(NAME, { [NAME]: "" }, new Map())).toBeUndefined();
  });
});
