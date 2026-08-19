module.exports = {
  forbidden: [
    {
      name: "contracts-imports-nothing",
      severity: "error",
      from: { path: "^src/contracts" },
      to: { pathNot: "^src/contracts" },
    },
    {
      name: "core-stays-pure",
      severity: "error",
      from: { path: "^src/core" },
      to: { path: "^src/(adapters|server|web)" },
    },
    {
      name: "adapters-only-contracts",
      severity: "error",
      from: { path: "^src/adapters" },
      to: { path: "^src/(core|server|web)" },
    },
    {
      name: "web-only-contracts",
      severity: "error",
      from: { path: "^src/web" },
      to: { path: "^src/(core|adapters|server)" },
    },
    {
      // Server serves web/dist, never imports web source
      name: "server-not-web-source",
      severity: "error",
      from: { path: "^src/server" },
      to: { path: "^src/web" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "pure-zones-no-store",
      severity: "error",
      from: { path: "^src/core/(reduce|receipts|attention|conflicts|reports)" },
      to: { path: "^src/core/store" },
    },
    {
      // `node:sqlite` keeps its prefix after resolution, unlike node:fs -> fs
      name: "sqlite-only-in-store",
      severity: "error",
      from: { path: "^src/core/(?!store/)" },
      to: { path: "^(node:)?sqlite$", dependencyTypes: ["core"] },
    },
    {
      // Pure zones take no IO at all; guards.mjs covers Date.now and random
      name: "pure-zones-no-io",
      severity: "error",
      from: { path: "^src/core/(reduce|receipts|attention|conflicts|reports)" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "web-no-node-builtins",
      severity: "error",
      from: { path: "^src/web" },
      to: { dependencyTypes: ["core"] },
    },
  ],
  options: {
    // Required. The default parser (acorn) emits no edge for `import type`, and these
    // boundaries are almost entirely type imports — without this every rule passes blindly.
    // Keeps typescript inside the range dependency-cruiser declares (>=2.0.0 <7.0.0).
    parser: "tsc",
    tsConfig: { fileName: "tsconfig.json" },
    // `development` first, so #-aliases resolve to src/ instead of dist/ and the
    // path-based rules above still match.
    enhancedResolveOptions: {
      conditionNames: ["development", "types", "import", "require", "node", "default"],
    },
    doNotFollow: { path: "node_modules" },
  },
};
