import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only the data layer is tested here. The components are thin arrangements of it, and a
    // snapshot of rendered markup would lock in styling decisions rather than behaviour.
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
    },
  },
});
