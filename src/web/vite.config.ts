import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// React Compiler is deliberately off: perf lives in Zustand per-actor selectors, not memoization.
// Enable via babel-plugin-react-compiler only if a profiler blames re-renders.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  // #-aliases always mean source here: Vite bundles from src, and contracts emit no runtime JS
  resolve: { conditions: ["development", "import", "browser", "default"] },
  build: { outDir: "../../dist/web", emptyOutDir: true },
  server: {
    // /api covers the SSE stream too; it is plain HTTP, so no websocket proxy is needed
    proxy: { "/api": "http://localhost:4242" },
  },
});
