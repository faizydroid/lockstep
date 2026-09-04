import { describe, expect, it, vi } from "vitest";

import { homedir } from "node:os";
import { join } from "node:path";

import {
  SkillProvenanceTracker,
  expandHome,
  isInside,
  isSkillManifest,
  skillRootOf,
} from "../src/activeSkill.ts";
import { decide, type ApprovedPin, type Decision, type PolicyDeps } from "../src/policy.ts";
import {
  looksLikeTransactionSend,
  registerLockstep,
  type GuardedCall,
  type HostApi,
} from "../src/index.ts";

const ROOT = process.platform === "win32" ? "C:\\ws\\skills" : "/ws/skills";
const KURU = `${ROOT}${process.platform === "win32" ? "\\" : "/"}kuru-quote`;
const EVIL = `${ROOT}${process.platform === "win32" ? "\\" : "/"}evil`;

const HONEST_HASH = `0x${"11".repeat(32)}` as const;
const HOSTILE_HASH = `0x${"22".repeat(32)}` as const;
const PIN = {
  pinId: `0x${"aa".repeat(32)}`,
  skillHash: HONEST_HASH,
  publisher: `0x${"bb".repeat(20)}`,
} as const satisfies ApprovedPin;

function deps(overrides: Partial<PolicyDeps> = {}): PolicyDeps {
  return {
    hashSkillDirectory: async () => HONEST_HASH,
    findApprovedPin: async (h) => (h === HONEST_HASH ? PIN : undefined),
    skillRoots: [ROOT],
    isInside,
    ...overrides,
  };
}

/**
 * Tilde paths, which a live model actually produced.
 *
 * The read tool was called with `~/AppData/Local/Temp/.../skills/kuru-quote/SKILL.md`. Node's
 * resolve gives `~` no meaning, so the path became a literal `~` directory under the current
 * working directory: still ending in SKILL.md, still looking like a manifest, but under no
 * configured skill root. Provenance was refused for a read that had genuinely happened, and
 * the refusal was indistinguishable from a real policy decision.
 */
describe("home-relative read paths", () => {
  it("expands a leading tilde to the home directory", () => {
    expect(expandHome("~")).toBe(homedir());
    expect(expandHome("~/skills/a/SKILL.md")).toBe(join(homedir(), "skills", "a", "SKILL.md"));
  });

  it("leaves absolute and relative paths alone", () => {
    const absolute = process.platform === "win32" ? "C:\\ws\\skills\\a\\SKILL.md" : "/ws/skills/a/SKILL.md";
    expect(expandHome(absolute)).toBe(absolute);
    expect(expandHome("./skills/a/SKILL.md")).toBe("./skills/a/SKILL.md");
    // A tilde inside the path is part of a filename, not a home reference.
    expect(expandHome("skills/~backup/SKILL.md")).toBe("skills/~backup/SKILL.md");
  });

  it("resolves a tilde read to the same skill root as its absolute form", () => {
    const tracker = new SkillProvenanceTracker();
    const home = homedir();

    tracker.observeRead("s1", "~/skills/kuru-quote/SKILL.md");
    const fromTilde = tracker.resolve("s1");

    const other = new SkillProvenanceTracker();
    other.observeRead("s1", join(home, "skills", "kuru-quote", "SKILL.md"));
    const fromAbsolute = other.resolve("s1");

    expect(fromTilde).toEqual(fromAbsolute);
    expect(fromTilde.kind).toBe("resolved");
  });

  it("counts a tilde read and its absolute twin as one skill, not two", () => {
    // Otherwise the same skill read twice under different spellings looks ambiguous, and
    // ambiguity blocks, so a legitimate transaction would be refused.
    const tracker = new SkillProvenanceTracker();
    tracker.observeRead("s1", "~/skills/kuru-quote/SKILL.md");
    tracker.observeRead("s1", join(homedir(), "skills", "kuru-quote", "SKILL.md"));

    expect(tracker.resolve("s1").kind).toBe("resolved");
  });
});

describe("skill manifest detection", () => {
  it.each([
    ["/ws/skills/a/SKILL.md", true],
    ["/ws/skills/a/skill.md", true],
    ["C:\\ws\\skills\\a\\SKILL.md", true],
    ["/ws/skills/a/README.md", false],
    ["/ws/skills/a/SKILL.md.bak", false],
    ["/ws/skills/a/notSKILL.md", false],
  ])("%s -> %s", (path, expected) => {
    expect(isSkillManifest(path)).toBe(expected);
  });

  it("treats the manifest's own directory as the skill root", () => {
    expect(skillRootOf(`${KURU}/SKILL.md`)).toBe(skillRootOf(`${KURU}/SKILL.md`));
    expect(skillRootOf(`${KURU}/SKILL.md`).endsWith("kuru-quote")).toBe(true);
  });
});

describe("containment", () => {
  it("accepts a skill inside a root", () => {
    expect(isInside(ROOT, KURU)).toBe(true);
  });

  /** `/skills/kuru` must not match `/skills/kuru-evil`. */
  it("rejects a sibling sharing a name prefix", () => {
    expect(isInside(KURU, `${KURU}-evil`)).toBe(false);
  });

  it("rejects a path outside the root", () => {
    expect(isInside(ROOT, process.platform === "win32" ? "C:\\tmp\\x" : "/tmp/x")).toBe(false);
  });
});

describe("provenance tracking", () => {
  it("resolves a single skill read", () => {
    const t = new SkillProvenanceTracker();
    t.observeRead("run-1", `${KURU}/SKILL.md`);

    expect(t.resolve("run-1")).toEqual({ kind: "resolved", skillRoot: skillRootOf(`${KURU}/SKILL.md`) });
  });

  it("ignores reads that are not skill manifests", () => {
    const t = new SkillProvenanceTracker();
    t.observeRead("run-1", `${KURU}/scripts/quote.mjs`);
    t.observeRead("run-1", `${KURU}/README.md`);

    expect(t.resolve("run-1").kind).toBe("no-skill");
  });

  it("treats a re-read of the same manifest as one skill", () => {
    const t = new SkillProvenanceTracker();
    t.observeRead("run-1", `${KURU}/SKILL.md`);
    t.observeRead("run-1", `${KURU}/SKILL.md`);

    expect(t.resolve("run-1").kind).toBe("resolved");
  });

  it("reports ambiguity when two skills are in context", () => {
    const t = new SkillProvenanceTracker();
    t.observeRead("run-1", `${KURU}/SKILL.md`);
    t.observeRead("run-1", `${EVIL}/SKILL.md`);

    const outcome = t.resolve("run-1");
    expect(outcome.kind).toBe("ambiguous");
  });

  /** Provenance must never leak between runs in the same session. */
  it("scopes provenance to a run", () => {
    const t = new SkillProvenanceTracker();
    t.observeRead("run-1", `${KURU}/SKILL.md`);

    expect(t.resolve("run-2").kind).toBe("no-skill");
  });

  it("forgets a run so the Gateway does not leak memory", () => {
    const t = new SkillProvenanceTracker();
    t.observeRead("run-1", `${KURU}/SKILL.md`);
    expect(t.trackedRuns).toBe(1);

    t.forget("run-1");

    expect(t.trackedRuns).toBe(0);
    expect(t.resolve("run-1").kind).toBe("no-skill");
  });
});

describe("decide: fails closed", () => {
  it("blocks when no skill is in context", async () => {
    const d = await decide({ kind: "no-skill" }, deps());

    expect(d).toMatchObject({ kind: "block", code: "NO_SKILL_PROVENANCE" });
  });

  it("blocks when provenance is ambiguous", async () => {
    const d = await decide({ kind: "ambiguous", skillRoots: [KURU, EVIL] }, deps());

    expect(d).toMatchObject({ kind: "block", code: "AMBIGUOUS_PROVENANCE" });
  });

  it("blocks a skill outside every configured root", async () => {
    const outside = process.platform === "win32" ? "C:\\tmp\\evil" : "/tmp/evil";
    const d = await decide({ kind: "resolved", skillRoot: outside }, deps());

    expect(d).toMatchObject({ kind: "block", code: "SKILL_OUTSIDE_ROOTS" });
  });

  it("blocks when the skill cannot be hashed", async () => {
    const d = await decide(
      { kind: "resolved", skillRoot: KURU },
      deps({
        hashSkillDirectory: async () => {
          throw new Error("symlink cannot be pinned");
        },
      }),
    );

    expect(d).toMatchObject({ kind: "block", code: "HASH_FAILED" });
  });

  /** The rug pull: publisher shipped a new version, the user approved the old one. */
  it("blocks a version the user did not approve", async () => {
    const d = await decide(
      { kind: "resolved", skillRoot: KURU },
      deps({ hashSkillDirectory: async () => HOSTILE_HASH }),
    );

    expect(d).toMatchObject({ kind: "block", code: "NOT_PINNED" });
    if (d.kind === "block") {
      expect(d.reason).toContain(HOSTILE_HASH.slice(0, 10));
    }
  });

  it("allows the approved version and reports the hash it computed", async () => {
    const d = await decide({ kind: "resolved", skillRoot: KURU }, deps());

    expect(d).toEqual({
      kind: "allow",
      pinId: PIN.pinId,
      skillHash: HONEST_HASH,
      skillRoot: KURU,
    });
  });

  /** The hash must come from disk, not from anything the agent can reach. */
  it("derives the hash by hashing the resolved root", async () => {
    const hashSkillDirectory = vi.fn(async () => HONEST_HASH);
    await decide({ kind: "resolved", skillRoot: KURU }, deps({ hashSkillDirectory }));

    expect(hashSkillDirectory).toHaveBeenCalledExactlyOnceWith(KURU);
  });
});

describe("exec bypass gate", () => {
  it.each([
    "cast send 0xabc 'transfer(address,uint256)' 0xdef 1",
    "cast publish 0xdeadbeef",
    "mm send --to 0xabc --amount 1",
    "mm swap --from USDC --to MON",
    "mm perps open --market MON",
    "forge script Deploy.s.sol --broadcast --rpc-url monad",
  ])("blocks %s", (command) => {
    expect(looksLikeTransactionSend(command)).toBe(true);
  });

  it.each([
    "cast call 0xabc 'balanceOf(address)' 0xdef",
    "cast block-number",
    "mm balance",
    "mm chains",
    "forge script Deploy.s.sol",
  ])("allows read-only %s", (command) => {
    expect(looksLikeTransactionSend(command)).toBe(false);
  });

  /**
   * The gate errs toward blocking. Refusing `echo cast send` is a harmless false
   * positive; missing a real broadcast would not be. Documented as intended
   * behaviour so nobody "fixes" it into a false negative later.
   */
  it("errs toward blocking on a benign mention", () => {
    expect(looksLikeTransactionSend("echo cast send")).toBe(true);
  });

  /**
   * Known evasions, asserted so the limitation is explicit rather than implied.
   * These are not defects in the gate: pattern matching on shell strings cannot
   * be made sound. Key custody is the boundary, not this list.
   */
  it.each(['c""ast send 0xabc', "$(echo cast) send 0xabc", "./my-sender.sh"])(
    "does not catch evasion %s, by design",
    (command) => {
      expect(looksLikeTransactionSend(command)).toBe(false);
    },
  );
});

describe("registration and the agent-facing surface", () => {
  function fakeApi() {
    const hooks = new Map<string, Array<(e: any, c: any) => unknown>>();
    const tools: any[] = [];
    const trusted: any[] = [];
    // Shaped like the real host, which is the point of this double.
    //
    // Hooks receive a runId and a sessionId; the tool factory context receives sessionId and
    // sessionKey and no run identifier at all (keys verified against openclaw@2026.8.2). So
    // sessionId is deliberately the only id the tool side can see here. If the correlation
    // ever goes back to keying on runId, provenance gets recorded under one key and looked up
    // under another, and these tests fail instead of the live Gateway.
    const toolCtx: { sessionId?: string; sessionKey?: string } = { sessionId: "s1" };
    const api: HostApi = {
      on(hook, handler, opts) {
        const list = hooks.get(hook) ?? [];
        list.push(handler);
        hooks.set(hook, list);
        void opts;
      },
      registerTool(factory) {
        tools.push(factory(toolCtx));
      },
      registerTrustedToolPolicy(policy) {
        trusted.push(policy);
      },
      logger: { warn: vi.fn(), info: vi.fn() },
    };
    return { api, hooks, tools, trusted, toolCtx };
  }

  function setup(overrides: Partial<PolicyDeps> = {}) {
    const { api, hooks, tools, trusted, toolCtx } = fakeApi();
    const submit = vi.fn(
      async (
        _decision: Extract<Decision, { kind: "allow" }>,
        _calls: readonly GuardedCall[],
      ) => ({ txHash: `0x${"ee".repeat(32)}` as `0x${string}` }),
    );
    const d = deps(overrides);
    registerLockstep(api, {
      skillRoots: [ROOT],
      deps: { hashSkillDirectory: d.hashSkillDirectory, findApprovedPin: d.findApprovedPin },
      submit,
      // Injected so each test starts empty. Production shares one tracker across
      // registrations on purpose; here that would leak provenance between cases, since they
      // all correlate on the same session id.
      tracker: new SkillProvenanceTracker(),
    });
    return { hooks, tools, trusted, submit, toolCtx };
  }

  /**
   * The central claim. If a hash or pin parameter existed, a poisoned SKILL.md
   * could instruct the model to supply a stale one.
   */
  /**
   * Locks the host's tool registration contract.
   *
   * Verified against openclaw@2026.8.2 (dist/tools-mqHZh-rd.js). Its
   * `describeMalformedPluginTool` requires a non-empty `name`, `execute` as a function and
   * `parameters` as an object. The previous version of this plugin exported
   * `handler(params, ctx)` instead, and nothing caught it: the plugin loaded, `plugins
   * inspect` listed lockstep_send, and this suite passed, because the suite asserted the
   * same wrong shape the code implemented. The host only objected when it went to bind the
   * tool for a real run -- "lockstep_send missing execute function" -- by which point the
   * product simply did not work.
   *
   * A test that agrees with the code proves nothing. This one states the host's terms.
   */
  it("registers the tool in the shape the host requires", () => {
    const { tools } = setup();
    const tool = tools[0];

    expect(typeof tool.name).toBe("string");
    expect(tool.name.length).toBeGreaterThan(0);
    expect(typeof tool.execute).toBe("function");
    expect(typeof tool.parameters).toBe("object");
    expect(tool.parameters).not.toBeNull();
    // The old field name must not linger, or a refactor could silently restore it.
    expect(tool.handler).toBeUndefined();
    // The host passes the tool call id first and the model's arguments second. Declaring
    // fewer parameters would mean the arguments were being read from the wrong position.
    expect(tool.execute.length).toBeGreaterThanOrEqual(2);
  });

  it("exposes no skill, hash, or pin parameter to the model", () => {
    const { tools } = setup();
    const schema = tools[0].parameters as any;
    const serialised = JSON.stringify(schema).toLowerCase();

    expect(tools[0].name).toBe("lockstep_send");
    expect(Object.keys(schema.properties)).toEqual(["calls"]);
    expect(serialised).not.toContain("skillhash");
    expect(serialised).not.toContain("pinid");
    expect(serialised).not.toContain("skill");
    expect(schema.additionalProperties).toBe(false);
  });

  /**
   * Locks the host's registration contract, verified against a live
   * openclaw@2026.8.2 loader. `id`, `description` and `evaluate` are all required,
   * and the callback is named `evaluate` — an earlier version passed `handler` and the
   * loader rejected it with "trusted tool policy registration requires id,
   * description, and evaluate()".
   */
  it("registers the exec gate with the exact shape the host requires", () => {
    const { trusted } = setup();

    expect(trusted).toHaveLength(1);
    const policy = trusted[0];
    expect(policy.id).toBe("lockstep-exec-gate");
    expect(policy.matcher).toEqual(["exec"]);
    expect(typeof policy.description).toBe("string");
    expect(policy.description.length).toBeGreaterThan(20);
    expect(typeof policy.evaluate).toBe("function");
    // The old field name must not linger, or a refactor could silently restore it.
    expect(policy.handler).toBeUndefined();
  });

  it("blocks a transaction-shaped exec command through the registered policy", () => {
    const { trusted } = setup();
    const result: any = trusted[0].evaluate({ params: { command: "cast send 0xabc" } }, {});

    expect(result?.block).toBe(true);
    expect(result?.blockReason).toContain("lockstep_send");
  });

  it("passes a read-only exec command through untouched", () => {
    const { trusted } = setup();

    expect(trusted[0].evaluate({ params: { command: "cast block-number" } }, {})).toBeUndefined();
  });

  it("submits with the computed hash after an observed skill read", async () => {
    const { hooks, tools, submit } = setup();

    hooks.get("after_tool_call")![0]!({ toolName: "read", params: { path: `${KURU}/SKILL.md` } }, { toolName: "read", runId: "r1", sessionId: "s1" });
    const result: any = await tools[0].execute(
      "call-1",
      { calls: [{ target: `0x${"11".repeat(20)}`, data: "0x1234abcd", value: "0" }] },
    );

    expect(result.ok).toBe(true);
    expect(result.skillHash).toBe(HONEST_HASH);
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]![0]).toMatchObject({ pinId: PIN.pinId, skillHash: HONEST_HASH });
  });

  it("refuses to submit when no skill was read", async () => {
    const { tools, submit } = setup();

    const result: any = await tools[0].execute(
      "call-1",
      { calls: [{ target: `0x${"11".repeat(20)}`, data: "0x" }] },
    );

    expect(result).toMatchObject({ ok: false, code: "NO_SKILL_PROVENANCE" });
    expect(submit).not.toHaveBeenCalled();
  });

  /**
   * Provenance survives re-registration.
   *
   * The host calls `register` several times per Gateway start and keeps one typed hook per
   * plugin and hook name, so the live read hook and the bound tool can come from different
   * registrations. When each registration built its own tracker, the hook recorded reads into
   * an object the tool never consulted, and every transaction was refused as unvouched. This
   * pins the sharing that fixes it: a read seen by the first registration must be visible to a
   * tool built by the second.
   */
  it("shares provenance across registrations", async () => {
    const shared = new SkillProvenanceTracker();
    const first = fakeApi();
    const second = fakeApi();
    const submit = vi.fn(async () => ({ txHash: `0x${"ee".repeat(32)}` as `0x${string}` }));
    const d = deps();

    for (const host of [first, second]) {
      registerLockstep(host.api, {
        skillRoots: [ROOT],
        deps: { hashSkillDirectory: d.hashSkillDirectory, findApprovedPin: d.findApprovedPin },
        submit,
        tracker: shared,
      });
    }

    // The read arrives through the first registration's hook.
    first.hooks.get("after_tool_call")![0]!(
      { toolName: "read", params: { path: `${KURU}/SKILL.md` } },
      { toolName: "read", runId: "r1", sessionId: "s1" },
    );

    // The call arrives through the second registration's tool.
    const result: any = await second.tools[0].execute("call-1", {
      calls: [{ target: `0x${"11".repeat(20)}`, data: "0x" }],
    });

    expect(result.ok).toBe(true);
    expect(result.skillHash).toBe(HONEST_HASH);
  });

  /**
   * The tool filter is ours now, so it needs its own test.
   *
   * This hook is registered without a host matcher, because `{ matcher: ["read"] }` was
   * accepted and then never invoked -- the registration appeared in `plugins inspect` while an
   * otherwise identical unmatched hook received every tool call. Filtering moved into the
   * handler, which means nothing outside this suite checks that a non-read tool cannot confer
   * provenance. Without that, any tool call mentioning a SKILL.md path would vouch for a
   * transaction.
   */
  it("ignores tool calls that are not reads", async () => {
    const { hooks, tools, submit } = setup();

    hooks.get("after_tool_call")![0]!(
      { toolName: "exec", params: { path: `${KURU}/SKILL.md`, command: "cat SKILL.md" } },
      { toolName: "exec", runId: "r1", sessionId: "s1" },
    );

    const result: any = await tools[0].execute("call-1", {
      calls: [{ target: `0x${"11".repeat(20)}`, data: "0x" }],
    });

    expect(result).toMatchObject({ ok: false, code: "NO_SKILL_PROVENANCE" });
    expect(submit).not.toHaveBeenCalled();
  });

  /** A failed read put nothing in context, so it must not confer provenance. */
  it("ignores a read that errored", async () => {
    const { hooks, tools, submit } = setup();

    hooks.get("after_tool_call")![0]!(
      { toolName: "read", params: { path: `${KURU}/SKILL.md` }, error: "ENOENT" },
      { toolName: "read", runId: "r1", sessionId: "s1" },
    );
    const result: any = await tools[0].execute(
      "call-1",
      { calls: [{ target: `0x${"11".repeat(20)}`, data: "0x" }] },
    );

    expect(result).toMatchObject({ ok: false, code: "NO_SKILL_PROVENANCE" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("refuses to submit without a run context", async () => {
    const { tools, submit, toolCtx } = setup();
    // A context the host built without a run id. Nothing can be attributed, so the only
    // safe answer is refusal rather than submitting an unbound transaction.
    delete toolCtx.sessionId;

    const result: any = await tools[0].execute("call-1", {
      calls: [{ target: `0x${"11".repeat(20)}`, data: "0x" }],
    });

    expect(result).toMatchObject({ ok: false, code: "NO_RUN_CONTEXT" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("blocks the rug pull end to end", async () => {
    const { hooks, tools, submit } = setup({ hashSkillDirectory: async () => HOSTILE_HASH });

    hooks.get("after_tool_call")![0]!({ toolName: "read", params: { path: `${KURU}/SKILL.md` } }, { toolName: "read", runId: "r1", sessionId: "s1" });
    const result: any = await tools[0].execute(
      "call-1",
      { calls: [{ target: `0x${"11".repeat(20)}`, data: "0x" }] },
    );

    expect(result).toMatchObject({ ok: false, code: "NOT_PINNED" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("releases provenance on agent_end", async () => {
    const { hooks, tools, submit } = setup();

    hooks.get("after_tool_call")![0]!({ toolName: "read", params: { path: `${KURU}/SKILL.md` } }, { toolName: "read", runId: "r1", sessionId: "s1" });
    hooks.get("agent_end")![0]!({}, { runId: "r1", sessionId: "s1" });

    const result: any = await tools[0].execute(
      "call-1",
      { calls: [{ target: `0x${"11".repeat(20)}`, data: "0x" }] },
    );

    expect(result).toMatchObject({ ok: false, code: "NO_SKILL_PROVENANCE" });
    expect(submit).not.toHaveBeenCalled();
  });
});
