import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// React Compiler is deliberately off: perf lives in Zustand per-actor selectors, not memoization.
// Enable via babel-plugin-react-compiler only if a profiler blames re-renders.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  // #-aliases always mean source here: Vite bundles from src, and contracts emit no runtime JS
  resolve: {
    conditions: ["development", "import", "browser", "default"],
    alias: { "@": import.meta.dirname },
  },
  build: { outDir: "../../dist/web", emptyOutDir: true },
  server: {
    // /api covers the SSE stream too; it is plain HTTP, so no websocket proxy is needed.
    // The daemon auto-picks a free port and writes it to ~/.pockrew/server.json unless
    // POCKREW_PORT pins one (src/server/registry.ts) — 7799 here is only a dev-time default,
    // never a hard bind (rules/server.md). Bind 127.0.0.1 to match the daemon's own bind.
    proxy: { "/api": `http://127.0.0.1:${process.env.POCKREW_PORT ?? "7799"}` },
  },
});
