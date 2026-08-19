# Pockrew — Agent Working Rules

Read this before touching the repo. `CLAUDE.md` includes this file, so both are the same rules.

## 1. Read first

`docs/spec.md` for what the product must be true about, `docs/architect.md` for how the code is
allowed to be shaped. Both are short and complete enough to work from.

## 2. `src/contracts/` is frozen

Need a change? Stop, propose the diff, wait for approval. Never edit it yourself.

## 3. `pnpm check` before every commit

It runs tsc (both projects), oxlint, dependency-cruiser, `tools/guards.mjs` and prettier. Red
means fix, never skip and never weaken a rule to get green.

Two options in `.dependency-cruiser.cjs` are load-bearing — do not remove them:

- `parser: "tsc"` — the default parser emits no dependency edge for `import type`, and these
  boundaries are almost entirely type imports, so every rule would pass blindly.
- `conditionNames` starting with `development` — otherwise `#`-aliases resolve into `dist/` and the
  path-based rules stop matching.

Both mean TypeScript must stay inside the range dependency-cruiser declares. Do not raise it.

## 4. Layer boundaries

Data flows one way: `adapters → core → server → web`. The web app sends intents back; it never
mutates state. `dependency-cruiser` enforces this, but know it before you write:

| Layer        | May import                                                 | Must not import                       |
| ------------ | ---------------------------------------------------------- | ------------------------------------- |
| `contracts/` | nothing, not even node builtins                            | everything                            |
| `core/`      | contracts, node builtins, `node:sqlite` (only in `store/`) | adapters, server, web                 |
| `adapters/`  | contracts, node builtins, chokidar                         | core, server, web                     |
| `server/`    | contracts, core, adapters, hono                            | web source (it serves `web/dist`)     |
| `web/`       | contracts, react and vite deps                             | core, adapters, server, node builtins |

Cross-layer imports use the subpath aliases declared in `package.json` `imports`:
`#contracts/…`, `#core/…`, `#adapters/…`, `#server/…`, always with a `.js` extension. Siblings in
the same directory stay relative. Do not add tsconfig `paths` — tsc does not rewrite them on emit.

## 5. Pure zones stay pure

`core/reduce`, `core/receipts`, `core/attention`, `core/conflicts`, `core/reports`: no IO, no node
builtins, no `Date.now()` (take a clock as a parameter), no importing `store/`.

## 6. No test on real fixtures, no pipeline logic

Every pipeline change needs a test running against `tests/fixtures/` (real, sanitized data). No
fixture yet? Capture one first with `pnpm capture`. Never guess a payload format.

## 7. Never fake a signal

Do not create an event, receipt, or relationship without a real signal behind it. Unsupported or
unknown state renders as "unknown". A `verified` label requires verifiable evidence — an exit code,
a git hash, an explicit completion event. Downgrade to `observed` rather than lie.

## 8. Stay in your zone

- Agent A: `src/adapters`, `src/core`, `src/server`
- Agent B: `src/web`
- Owner only: `src/contracts`, `docs`, config files

Do not edit another zone. If your change needs one, say so and stop.

## 9. No new dependencies

The stack is settled. Adding one needs approval, including dev dependencies. Also never take a
package version published less than 24 hours ago: pnpm quarantines them, and forcing it through
writes a `minimumReleaseAgeExclude` list into `pnpm-workspace.yaml`. Seeing that list appear means
something bypassed the gate.

## 10. Code style — scoped rule files

Style rules live in `.claude/rules/`, scoped by glob. **Load the rule file whose globs match the
files you are touching; do not apply a rule outside its scope** (e.g. React rules never apply to
`src/core`). Claude Code loads them by glob automatically; other tools read them as role prompts.

| Rule file                     | Scope                                | Covers                                                                                                                           |
| ----------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/rules/typescript.md` | all `.ts`/`.tsx`                     | kebab-case files, arrow functions, no re-defined types, SOLID/KISS, scripts                                                      |
| `.claude/rules/react.md`      | `src/web/**`                         | atomic design, `FC<Props>`, `handleXxx`/`onXxx`, useEffect placement, Zustand/immer/Context, `@/` alias, mobile-first, Hugeicons |
| `.claude/rules/server.md`     | `src/server/**`, `src/core/store/**` | Hono REST/MVC handler split, SQLite no-N+1, security invariants                                                                  |

## 11. Commits

Small, message in English, prefixed by zone: `core:`, `adapter/claude:`, `web:`, `server:`,
`chore:`.

## Agent roles

Two subagents are defined in `.claude/agents/`. Claude Code picks them up directly; other tools can
read the same files as role prompts.

- `coder` — small model. Implements one bounded change inside one zone, then runs `pnpm check`.
- `reviewer` — medium model. Read-only. Checks a diff against the rules above and reports findings.
