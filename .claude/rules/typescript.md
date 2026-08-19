---
globs: ["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts", "tools/**/*.ts"]
description: TypeScript style rules — apply only to TS/TSX files
---

# TypeScript rules

- **File names: kebab-case** (`attention-drawer.ts`). A React component groups into its own
  folder: `attention-drawer/index.tsx` + `styles.module.css`, component-local types in `types.ts`.
- **Arrow functions only** — `const f = () => {}`, never `function f()`.
- **Never re-define a type.** Derive with `Pick`, `Omit`, `NonNullable`, indexed access
  (`T["field"]`) or inference. `src/contracts/` is the source of truth for shared shapes.
- **SOLID + KISS.** One responsibility per module; depend on contracts, not implementations;
  never add a layer, abstraction, or option the current milestone does not need.
- Every dev/test/ops command lives in `package.json` `scripts`.
