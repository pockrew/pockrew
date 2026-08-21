import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve #-aliases to src, matching tsconfig customConditions; "@/" mirrors
  // the web alias in src/web/vite.config.ts so web tests resolve the same imports.
  resolve: {
    conditions: ["development", "import", "node", "default"],
    alias: { "@": fileURLToPath(new URL("./src/web", import.meta.url)) },
  },
  test: { include: ["tests/**/*.test.ts", "src/**/*.test.ts"] },
});
