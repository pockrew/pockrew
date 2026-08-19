import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve #-aliases to src, matching tsconfig customConditions
  resolve: { conditions: ["development", "import", "node", "default"] },
  test: { include: ["tests/**/*.test.ts", "src/**/*.test.ts"] },
});
