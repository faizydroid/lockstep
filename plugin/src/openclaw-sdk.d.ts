/**
 * Ambient declarations for the parts of the OpenClaw plugin SDK this plugin uses.
 *
 * `openclaw` is a peer dependency, not a direct one: it is always present at runtime
 * because the plugin only ever runs inside a Gateway, and depending on it directly
 * would pull 331 packages into this repository to obtain two helper functions.
 *
 * These signatures were read from `openclaw@2026.8.2`:
 *   dist/plugin-entry-JqJbpnY0.js  (definePluginEntry)
 *   dist/config-schema-C0g9-HRq.js (buildJsonPluginConfigSchema)
 *
 * `definePluginEntry` is a shape normaliser — it returns `{ id, name, description,
 * configSchema (lazy getter), register }`. `configSchema` is deliberately *not* a
 * plain JSON Schema at this layer; it is a function returning
 * `{ safeParse, jsonSchema }`, which is why the helper is used rather than an object
 * literal.
 */

declare module "openclaw/plugin-sdk/plugin-entry" {
  export interface PluginConfigSchema {
    safeParse(value: unknown): { success: boolean; data?: unknown; error?: unknown };
    jsonSchema: unknown;
  }

  export function buildJsonPluginConfigSchema(
    schema: unknown,
    options?: { cacheKey?: string },
  ): PluginConfigSchema;

  export function definePluginEntry(entry: {
    id: string;
    name?: string;
    description?: string;
    kind?: string;
    configSchema?: () => PluginConfigSchema;
    register: (api: unknown) => void;
  }): unknown;
}
