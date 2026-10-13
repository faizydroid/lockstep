/**
 * OpenClaw plugin entry point.
 *
 * Thin by design. All the logic and every test lives in `index.ts`, `policy.ts`, and
 * `activeSkill.ts`, none of which import anything from OpenClaw. This file is the only
 * place the host's SDK appears, so the security-critical code stays testable without a
 * Gateway.
 *
 * The host requires a **default** export shaped by `definePluginEntry`. A named
 * `register` function is not enough: an earlier version exported only
 * `registerLockstep` and the host rejected it at validation with
 * `plugin export missing register/activate`.
 */

import {
  buildJsonPluginConfigSchema,
  definePluginEntry,
} from "openclaw/plugin-sdk/plugin-entry";

import { hashSkillDirectory } from "@lockstep/runtime";

import { ChainAdapter } from "./chain.ts";
import { registerLockstep, type HostApi } from "./index.ts";
import { claimSecretFromEnv } from "./keyCustody.ts";

/**
 * Mirrors `configSchema` in `openclaw.plugin.json`.
 *
 * Declared twice because the two are used at different times: the manifest is read
 * without importing the plugin runtime, for install-time validation, while this one
 * validates config when the plugin actually loads. If you change one, change both.
 */
const CONFIG_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["registry", "account", "chainId"],
  properties: {
    registry: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
    account: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
    chainId: { type: "integer", enum: [143, 10143] },
    rpcUrl: { type: "string" },
    executorPrivateKeyEnv: { type: "string", default: "LOCKSTEP_EXECUTOR_KEY" },
    skillRoots: { type: "array", items: { type: "string" } },
    trustedPublishers: {
      type: "array",
      items: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
    },
  },
} as const;

interface LockstepConfig {
  readonly registry: `0x${string}`;
  readonly account: `0x${string}`;
  readonly chainId: 143 | 10143;
  readonly rpcUrl?: string;
  readonly executorPrivateKeyEnv?: string;
  readonly skillRoots?: readonly string[];
  readonly trustedPublishers?: readonly `0x${string}`[];
}

interface ApiWithConfig extends HostApi {
  readonly pluginConfig?: unknown;
}

export default definePluginEntry({
  id: "lockstep",
  name: "Lockstep",
  description:
    "Binds every fund-moving call to the exact skill version the account owner approved.",
  configSchema: () => buildJsonPluginConfigSchema(CONFIG_SCHEMA),

  register(rawApi: unknown) {
    const api = rawApi as ApiWithConfig;
    const config = api.pluginConfig as LockstepConfig | undefined;

    if (config === undefined) {
      // Refuse to register a half-configured guard. Registering the hooks without a
      // chain adapter would leave `lockstep_send` present but non-functional, and an
      // agent would read that as "transactions are unavailable" rather than
      // "Lockstep is misconfigured".
      api.logger.warn(
        "lockstep: no plugin config found. Set plugins.entries.lockstep.config with registry, account and chainId, then restart the Gateway.",
      );
      return;
    }

    const keyEnv = config.executorPrivateKeyEnv ?? "LOCKSTEP_EXECUTOR_KEY";
    // Claimed, not just read: the variable is removed from the Gateway's environment so the agent's
    // exec tool cannot hand it to a child process. See keyCustody.ts for what that does and does not buy.
    const executorKey = claimSecretFromEnv(keyEnv);
    if (executorKey === undefined || executorKey === "") {
      api.logger.warn(
        `lockstep: ${keyEnv} is not set. The executor key is read from the environment and never from config, so nothing can be submitted until it is present.`,
      );
      return;
    }

    const rpcUrl =
      config.rpcUrl ??
      (config.chainId === 143 ? "https://rpc.monad.xyz" : "https://testnet-rpc.monad.xyz");

    // Throws if the executor key equals the account key. Failing at startup is
    // correct: an agent holding the account key can sign straight past the guard, so
    // that configuration cannot enforce anything and must not appear to.
    const chain = new ChainAdapter({
      rpcUrl,
      chainId: config.chainId,
      registry: config.registry,
      account: config.account,
      executorPrivateKey: executorKey as `0x${string}`,
      ...(config.trustedPublishers === undefined ? {} : { trustedPublishers: config.trustedPublishers }),
    });

    if (config.trustedPublishers === undefined || config.trustedPublishers.length === 0) {
      api.logger.warn(
        "lockstep: no trustedPublishers configured, so approvals are found by scanning the account's logs. " +
          "Monad's public RPC refuses log queries wider than 100 blocks, so on a public endpoint that scan fails " +
          "and every guarded send is refused. Set trustedPublishers to the publisher addresses you approve skills from.",
      );
    }

    api.logger.info(
      `lockstep: guarding ${config.account} on chain ${config.chainId}, executor ${chain.executorAddress}`,
    );

    registerLockstep(api, {
      skillRoots: config.skillRoots ?? [],
      deps: {
        hashSkillDirectory: async (root) => (await hashSkillDirectory(root)).skillHash,
        findApprovedPin: chain.findApprovedPin,
      },
      submit: chain.submit,
    });
  },
});
