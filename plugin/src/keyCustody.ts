/**
 * Taking the executor key out of the process environment.
 *
 * The key has to reach the plugin somehow, and it arrives as an environment variable of the Gateway.
 * That is also exactly where an agent's `exec` tool looks: OpenClaw builds every command's environment
 * from the Gateway's `process.env` (`bash-tools`, `coerceEnv(process.env)`), and its host-environment
 * sanitiser removes loader and PATH overrides, not secrets. So for as long as the variable stays in
 * `process.env`, any command a skill tells the agent to run starts with the key in its environment, and
 * a script holding the key can call `LockstepGuard.execute(pinId, <the approved hash>, calls)` directly.
 * The pin id and the approved hash are public on chain, and the guard checks target, selector and value
 * but not arguments, so that bypasses the plugin, the provenance check and the exec gate in one step.
 *
 * Reading the key once and deleting the variable closes the default path: the Gateway keeps the key in
 * memory, and no child process inherits it.
 *
 * What this does NOT do, stated because it is easy to over-read:
 *
 *   - On Linux the Gateway's original environment block stays readable at `/proc/<pid>/environ` by any
 *     process of the same user, and a same-user child can read the Gateway's memory. Deleting the
 *     variable does not stop a determined attacker running as the Gateway's user.
 *   - It does not help if something else copied `process.env` before the plugin loaded.
 *
 * The boundary that does hold is not running agent commands in the Gateway's own context: OpenClaw's
 * sandbox (`agents.defaults.sandbox.mode`, off by default) runs `exec` in a container that does not
 * receive the Gateway's environment, or the key can be held by a separate signing process. This module
 * is the cheap half of that, not a substitute for it.
 *
 * The host calls a plugin's `register` more than once (three times in one observed Gateway start), so a
 * value claimed on the first call has to survive for the next ones. That is the only reason this module
 * keeps state.
 */

const claimed = new Map<string, string>();

/**
 * Returns the value of `name` from `env`, and removes it from `env` so child processes cannot inherit it.
 * Later calls return the same value, since the variable is gone by then.
 *
 * `env` and `store` default to the real process environment and the module's own store; they are
 * parameters so a test can use its own without touching the process.
 */
export function claimSecretFromEnv(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  store: Map<string, string> = claimed,
): string | undefined {
  const value = env[name];
  if (value !== undefined && value !== "") {
    store.set(name, value);
    delete env[name];
  }
  return store.get(name);
}
