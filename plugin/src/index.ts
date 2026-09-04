/**
 * Lockstep plugin for OpenClaw.
 *
 * Binds every fund-moving call to the exact skill version that produced it.
 *
 * ## Why the agent cannot forge provenance
 *
 * The tool exposed to the model has no `skillHash`, no `pinId`, and no `skill`
 * parameter. The parameter does not exist, so there is nothing for a poisoned
 * SKILL.md to instruct the model to fill in. Provenance comes from what the
 * plugin observed the runtime do, and the hash is computed here from disk.
 *
 * A model that lies about which skill it is using gains nothing: the worst it can
 * achieve is to be confined to the capability bounds of some *other* pin the user
 * already approved. It can never exceed a pin, and it can never act with no pin
 * at all, because `decide()` fails closed on absent and ambiguous provenance.
 *
 * ## Defence in depth
 *
 * `registerTrustedToolPolicy` blocks `exec` invocations of known transaction
 * senders. Without it, a skill could bypass this tool entirely by shelling out to
 * `cast send` or `mm send`. That gate runs before ordinary `before_tool_call`
 * hooks, so an installed plugin cannot un-block it.
 *
 * ## Failure posture
 *
 * OpenClaw's runner treats a thrown or timed-out `before_tool_call` handler as
 * fail-closed and blocks the call. That is the behaviour we want, so this code
 * does not swallow errors to keep an agent running.
 */

import type { Decision, PolicyDeps } from "./policy.ts";
import { decide } from "./policy.ts";
import {
  SkillProvenanceTracker,
  expandHome,
  isInside,
  isSkillManifest,
  skillRootOf,
} from "./activeSkill.ts";

/**
 * Commands that look like they broadcast a transaction.
 *
 * This is best-effort defence in depth, **not** a security boundary, and the
 * distinction matters. Shell-command pattern matching is trivially evadable:
 * `c""ast send`, `$(echo cast) send`, a renamed binary, or a wrapper script all
 * slip past it, and no amount of regex tightening fixes that.
 *
 * The actual boundary is key custody. The agent's executor address holds no
 * funds, so a `cast send` it manages to run can only spend from an account whose
 * key it already has — which, by design, is not the account holding the money.
 * This gate exists to catch misconfiguration and to give a clear error instead of
 * a confusing on-chain failure.
 *
 * Because it is not a boundary, it errs toward blocking. `echo cast send` is
 * refused, which is a harmless false positive; missing a real send would not be.
 */
const TRANSACTION_SENDERS: readonly RegExp[] = [
  /\bcast\s+send\b/,
  /\bcast\s+publish\b/,
  /\bmm\s+(?:tx|send|transfer|swap|bridge|perps|earn|predict)\b/,
  /\bforge\s+script\b.*--broadcast\b/,
];

export function looksLikeTransactionSend(command: string): boolean {
  return TRANSACTION_SENDERS.some((pattern) => pattern.test(command));
}

export interface LockstepPluginConfig {
  readonly skillRoots: readonly string[];
  readonly deps: Omit<PolicyDeps, "skillRoots" | "isInside">;
  /** Submits a guarded batch. Receives the decision, never agent-supplied ids. */
  readonly submit: (
    decision: Extract<Decision, { kind: "allow" }>,
    calls: readonly GuardedCall[],
  ) => Promise<{ readonly txHash: `0x${string}` }>;
  /**
   * Provenance store to use. Omit in production to share the process-wide one.
   *
   * Exists so tests get isolation without reaching for a reset hook. Production must not
   * pass this: provenance has to be shared across registrations, for the reason described
   * on `sharedTracker`.
   */
  readonly tracker?: SkillProvenanceTracker;
}

export interface GuardedCall {
  readonly target: `0x${string}`;
  readonly value: string;
  readonly data: `0x${string}`;
}

/**
 * Registers Lockstep against a plugin api.
 *
 * Typed structurally rather than against `OpenClawPluginApi` so this module and
 * its tests do not require the `openclaw` package to be installed. The shape
 * matches the documented `api.on` / `api.registerTool` contract.
 */
export interface HostApi {
  on(
    hook: string,
    handler: (event: any, ctx: any) => unknown,
    opts?: { matcher?: string[]; priority?: number; registrationId?: string },
  ): void;
  /**
   * Takes a factory, not a finished tool.
   *
   * Contract verified against openclaw@2026.8.2 (dist/tools-mqHZh-rd.js). Its
   * `describeMalformedPluginTool` requires a non-empty `name`, `execute` as a function and
   * `parameters` as an object, and the host calls `execute(toolCallId, params, signal,
   * onUpdate)` -- so the arguments the model supplied arrive second, not first.
   *
   * An earlier version passed a plain object with a `handler(params, ctx)`. The plugin
   * loaded, `plugins inspect` listed the tool, and every check passed, because the host only
   * rejects the tool when it tries to bind it for a run: "plugin tool is malformed
   * (lockstep): lockstep_send missing execute function". The tool was never callable.
   *
   * The factory form is what the bundled plugins use, and it is the only way to reach the
   * per-run context the provenance lookup needs.
   */
  registerTool(
    factory: (ctx: any) => {
      name: string;
      description: string;
      parameters: unknown;
      execute: (
        toolCallId: string,
        params: any,
        signal?: unknown,
        onUpdate?: unknown,
      ) => Promise<unknown>;
    },
  ): void;
  registerTrustedToolPolicy?(policy: {
    id: string;
    description: string;
    matcher?: string[];
    evaluate: (event: any, ctx: any) => unknown;
  }): void;
  logger: { warn(msg: string): void; info(msg: string): void };
}

/**
 * Provenance store shared by every registration in this process.
 *
 * The host calls a plugin's `register` more than once -- three times in one observed Gateway
 * start -- and it keys typed hooks by plugin id and hook name, so the surviving read hook
 * belongs to one registration while the bound tool can belong to another. With a tracker per
 * registration those are different objects: the hook records a skill read, the tool looks in
 * an empty map, and every transaction is refused with "no skill instructions are in context".
 * The debug trace showed exactly that, the hook counting up to one entry while lockstep_send
 * kept reporting tracked=0.
 *
 * Sharing it is also correct on its own terms. Provenance is scoped to a run, not to a
 * registration, and a config reload mid-run must not discard what has already been observed.
 */
let sharedTracker: SkillProvenanceTracker | undefined;

export function registerLockstep(api: HostApi, config: LockstepPluginConfig): SkillProvenanceTracker {
  const tracker = config.tracker ?? (sharedTracker ??= new SkillProvenanceTracker());

  // Traces how provenance was recorded and looked up. Every refusal reads identically from the
  // agent's side -- "no skill instructions are in context" -- whether the hook never ran, the
  // read was not a manifest, or provenance was filed under an id the tool then looked past.
  // Those have different fixes and no way to tell them apart from outside.
  const debugEnabled = process.env.LOCKSTEP_DEBUG !== undefined && process.env.LOCKSTEP_DEBUG !== "";

  const policyDeps: PolicyDeps = {
    ...config.deps,
    skillRoots: config.skillRoots,
    isInside,
  };

  // 1. Observe which skills entered context. `after_tool_call` rather than
  //    `before_tool_call`: a read that failed did not put anything in context.
  //
  // One registration for this hook name, and exactly one.
  //
  // The host keys typed hooks by plugin id and hook name, so a second `api.on
  // ("after_tool_call", ...)` from this plugin does not add a listener -- it replaces the
  // first one. A debug hook registered separately therefore silently displaced this handler:
  // the trace showed every tool call arriving while provenance recorded nothing, which looks
  // like the filter rejecting reads rather than the handler being gone. Debug tracing lives
  // inside this function for that reason.
  //
  // The tool filter is also here rather than in a `matcher` option, so the whole decision is
  // visible in one place and does not depend on an undocumented matching contract.
  api.on(
    "after_tool_call",
    (event: any, ctx: any) => {
      const toolName = event?.toolName ?? ctx?.toolName;

      if (debugEnabled) {
        const debugPath = event?.params?.path;
        const command = event?.params?.command;
        api.logger.info(
          `lockstep[debug]: after_tool_call tool=${toolName ?? "unknown"} ` +
            `correlation=${resolveCorrelationId(ctx, event) ?? "none"} ` +
            `error=${event?.error === undefined ? "none" : String(event.error).slice(0, 80)} ` +
            // The values, not just the key names. Whether a read counts as a skill manifest is
            // decided entirely by this path, and a rejected read is indistinguishable from an
            // unseen one without it.
            `path=${typeof debugPath === "string" ? debugPath : "n/a"} ` +
            `isManifest=${typeof debugPath === "string" ? isSkillManifest(debugPath) : "n/a"} ` +
            `command=${typeof command === "string" ? command.slice(0, 120) : "n/a"}`,
        );
      }

      if (toolName !== "read") return;
      if (event?.error !== undefined) return;
      const correlationId = resolveCorrelationId(ctx, event);
      if (correlationId === undefined) {
        api.logger.warn(
          `lockstep: read observed with no correlation id (ctx keys: ${describeKeys(ctx)}). ` +
            "Skill provenance cannot be recorded and every guarded transaction will be refused.",
        );
        return;
      }

      // `path` is the read tool's parameter, verified against openclaw@2026.8.2:
      // its input schema is { path, offset, limit, cursor, optional }.
      const path = event?.params?.path;
      if (typeof path !== "string") {
        // Fail loud, not silent. If a future release renames this field,
        // provenance never establishes and every transaction blocks — safe, but
        // baffling. A warning makes the cause findable in one log line instead of
        // a debugging session.
        api.logger.warn(
          `lockstep: read tool call had no string 'path' parameter (got keys: ${Object.keys(event?.params ?? {}).join(", ") || "none"}). ` +
            "Skill provenance cannot be established and every guarded transaction will be refused. " +
            "The read tool's schema may have changed.",
        );
        return;
      }
      if (debugEnabled) {
        api.logger.info(
          `lockstep[debug]: recorded read correlation=${correlationId} ` +
            `root=${skillRootOf(expandHome(path))} tracked=${tracker.trackedRuns}`,
        );
      }
      tracker.observeRead(correlationId, path);
    },
    { registrationId: "lockstep-provenance" },
  );

  // 2. Release per-run provenance. Without this the map grows for the lifetime
  //    of the Gateway and finished runs stay attributable.
  api.on("agent_end", (event: any, ctx: any) => {
    const correlationId = resolveCorrelationId(ctx, event);
    if (correlationId !== undefined) tracker.forget(correlationId);
  });

  // 3. Close the bypass. A skill could otherwise shell out to `cast send`.
  //    Registered as a trusted policy so it runs ahead of ordinary hooks.
  const execGate = (event: any) => {
    const command =
      typeof event?.params?.command === "string"
        ? event.params.command
        : typeof event?.params?.cmd === "string"
          ? event.params.cmd
          : "";
    if (command !== "" && looksLikeTransactionSend(command)) {
      return {
        block: true,
        blockReason:
          "Lockstep: transactions must go through the lockstep_send tool so their skill provenance can be bound. Direct sends are blocked.",
      };
    }
    return undefined;
  };

  if (typeof api.registerTrustedToolPolicy === "function") {
    // Contract verified against openclaw@2026.8.2 (dist/loader-DhyKX__3.js):
    // `{ id, description, evaluate }` are all required, and the callback is named
    // `evaluate`, not `handler`. The host also requires the id to appear in
    // `contracts.trustedToolPolicies` and the plugin to be explicitly enabled.
    // An earlier version passed `{ id, matcher, handler }` and the loader rejected it
    // with "trusted tool policy registration requires id, description, and evaluate()".
    api.registerTrustedToolPolicy({
      id: "lockstep-exec-gate",
      description:
        "Blocks exec commands that broadcast transactions, so they cannot bypass lockstep_send and lose their skill provenance.",
      matcher: ["exec"],
      evaluate: execGate,
    });
  } else {
    // Older hosts without the trusted tier still get the gate, just at ordinary
    // priority where another plugin could in principle outrank it.
    api.logger.warn(
      "lockstep: trusted tool policies unavailable; exec gate registered at ordinary priority",
    );
    api.on("before_tool_call", execGate, { matcher: ["exec"], priority: 1000 });
  }

  // 4. The only sanctioned way for a skill to move funds.
  //
  //    Note the parameter schema: target, value, data. No skill, no hash, no pin.
  //    A poisoned SKILL.md has no field to lie through.
  api.registerTool((toolCtx: any) => ({
    name: "lockstep_send",
    description:
      "Submit onchain calls from the agent account. The active skill's version is bound to the transaction automatically; calls are rejected unless that exact version is pinned and approved.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["calls"],
      properties: {
        calls: {
          type: "array",
          minItems: 1,
          maxItems: 16,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["target", "data"],
            properties: {
              target: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
              value: { type: "string", pattern: "^[0-9]+$", default: "0" },
              data: { type: "string", pattern: "^0x([0-9a-fA-F]{2})*$" },
            },
          },
        },
      },
    },
    execute: async (_toolCallId: string, params: any) => {
      const correlationId = resolveCorrelationId(toolCtx);
      if (correlationId === undefined) {
        // No run id means no provenance can be established, so there is nothing to bind the
        // call to and the only safe answer is to refuse. Logged loudly because a host change
        // here would block every transaction with an error that reads like a chain problem.
        api.logger.warn(
          `lockstep: no correlation id available in the tool context (keys: ${describeKeys(toolCtx)}). ` +
            "Skill provenance cannot be established and every guarded transaction will be refused.",
        );
        return {
          ok: false,
          code: "NO_RUN_CONTEXT",
          error: "Lockstep could not identify the current run, so no skill provenance is available.",
        };
      }

      if (debugEnabled) {
        api.logger.info(
          `lockstep[debug]: lockstep_send correlation=${correlationId} ` +
            `tracked=${tracker.trackedRuns} outcome=${tracker.resolve(correlationId).kind}`,
        );
      }

      const decision = await decide(tracker.resolve(correlationId), policyDeps);
      if (decision.kind === "block") {
        return { ok: false, code: decision.code, error: `Lockstep: ${decision.reason}` };
      }

      const calls: GuardedCall[] = (params?.calls ?? []).map((c: any) => ({
        target: c.target,
        value: typeof c.value === "string" && c.value !== "" ? c.value : "0",
        data: c.data ?? "0x",
      }));

      const { txHash } = await config.submit(decision, calls);
      return {
        ok: true,
        txHash,
        skillHash: decision.skillHash,
        pinId: decision.pinId,
      };
    },
  }));

  return tracker;
}

/** Lists an object's keys for a diagnostic, without risking a throw on odd values. */
function describeKeys(value: unknown): string {
  if (value === null || typeof value !== "object") return typeof value;
  try {
    const own = Object.keys(value as Record<string, unknown>);
    // Getters and prototype methods do not show up in Object.keys, and on a host-built
    // context object that is usually where the interesting accessors live.
    const proto = Object.getPrototypeOf(value) as object | null;
    const inherited =
      proto !== null && proto !== Object.prototype
        ? Object.getOwnPropertyNames(proto).filter((k) => k !== "constructor")
        : [];
    return [...own, ...inherited].join(", ") || "none";
  } catch {
    return "unreadable";
  }
}

/**
 * The id used to tie a `lockstep_send` call back to the skill read that preceded it.
 *
 * One function for both sides on purpose. The hook context and the tool factory context are
 * built by different parts of the host and expose different fields: hooks carry a runId,
 * while the tool factory context carries sessionId and sessionKey and no run identifier at
 * all. Correlating requires an id both can produce, so session is preferred and run is only a
 * fallback. Two resolvers that happened to disagree would fail in the worst possible way --
 * provenance recorded under one key and looked up under another, so every legitimate
 * transaction refused for no visible reason.
 *
 * Order matters and is the same everywhere this is called. Returns undefined rather than
 * inventing an id, because a fabricated key silently isolates the caller from its own reads.
 */
function resolveCorrelationId(ctx: any, event?: any): string | undefined {
  const candidates = [
    ctx?.sessionId,
    ctx?.sessionKey,
    event?.sessionId,
    ctx?.runId,
    event?.runId,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate !== "") return candidate;
  }
  return undefined;
}
