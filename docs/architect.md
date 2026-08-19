# Pockrew — Architecture

Strict at the boundaries, free inside them. Every rule here is machine-enforced by `pnpm check`;
none of it relies on remembering.

## Data flow

One process, one direction:

```text
Claude hooks ──POST──┐                                            SSE ──▶ web
Claude JSONL ──tail──┼──▶ adapters ──RawSourceEvent──▶ core ──▶ server
Codex files  ──tail──┘                                            ◀── POST intents
```

Inside core: `normalize` (redact, sanitize, dedupe) → `store` (SQLite, append-only) → `reduce`
(actor state machine) → derive (`receipts`, `attention`, `conflicts`, `reports`) → `world.ts`
assembles `WorldState` → server sends a snapshot, then patches.

Three invariants:

1. **Data flows one way.** The web app never mutates state. It sends a `UserIntent` by POST; the
   intent goes through a core command. The transport enforces this rather than trusting discipline:
   the server-to-web channel is a one-directional SSE stream, so there is no socket to smuggle a
   mutation back through.
2. **The SQLite events table is the source of truth.** Every actor and `WorldState` rebuilds from
   events plus derived tables. Nothing lives outside that loop except ephemeral UI state.
3. **Every trust-building function is pure.** `reduce`, `receipts`, `attention`, `conflicts`,
   `reports` do no IO, never call `Date.now()` (a clock is a parameter), and use no randomness —
   which is what makes fixture replay a complete test.

## Layout

Single package, not a monorepo.

```text
src/
  contracts/    ❄️ frozen — pure types, imports nothing
  adapters/     provider readers: hook handlers, JSONL watchers, mappers
  core/         normalize, store/, reduce/, receipts/, attention/, conflicts/,
                reports/, world.ts, pipeline.ts
  server/       cli.ts, http.ts, stream.ts, registry.ts, pairing.ts, setup/
  web/          Vite React app, styles.css, world/, panels/, state.ts
tools/capture/  hook capture endpoint for collecting real fixtures
tests/          fixtures/ (real, sanitized — the most valuable asset here), replay harness
docs/           this file and spec.md
.claude/agents/ coder and reviewer subagent definitions
.github/        CI plus the pull-request template
```

## Boundaries

| Layer        | May import                                                 | Must not import                       |
| ------------ | ---------------------------------------------------------- | ------------------------------------- |
| `contracts/` | nothing, not even node builtins                            | everything                            |
| `core/`      | contracts, node builtins, `node:sqlite` (only in `store/`) | adapters, server, web                 |
| `adapters/`  | contracts, node builtins, chokidar                         | core, server, web                     |
| `server/`    | contracts, core, adapters, hono                            | web source — it serves `web/dist`     |
| `web/`       | contracts, react and vite deps                             | core, adapters, server, node builtins |

Adapters emit `RawSourceEvent` and do no cleaning of their own. Normalizing is core's job, so all
sanitizing logic is tested in one place.

Pure zones — `core/reduce`, `core/receipts`, `core/attention`, `core/conflicts`, `core/reports` —
additionally import no `store/` and no node builtins at all.

Ten `dependency-cruiser` rules cover the table: `contracts-imports-nothing`, `core-stays-pure`,
`adapters-only-contracts`, `web-only-contracts`, `web-no-node-builtins`, `server-not-web-source`,
`sqlite-only-in-store`, `pure-zones-no-store`, `pure-zones-no-io`, `no-circular`.
`tools/guards.mjs` covers the one thing imports cannot express: no `Date.now`, `new Date`,
`Math.random`, or `performance.now` inside a pure zone.

## Path aliases

Cross-layer imports use Node subpath imports declared in `package.json`, always with a `.js`
extension. Same-directory imports stay relative.

```json
"imports": {
  "#contracts/*.js": { "development": "./src/contracts/*.ts", "default": "./dist/contracts/*.js" },
  "#core/*.js":      { "development": "./src/core/*.ts",      "default": "./dist/core/*.js" },
  "#adapters/*.js":  { "development": "./src/adapters/*.ts",  "default": "./dist/adapters/*.js" },
  "#server/*.js":    { "development": "./src/server/*.ts",    "default": "./dist/server/*.js" }
}
```

Not tsconfig `paths`: TypeScript does not rewrite those on emit, so `dist/server/*.js` would ship
dead specifiers and need `tsc-alias` or a bundler. Node resolves `imports` at runtime instead.

Four resolvers must each be told about the condition. Miss one and that one breaks:

| Where                                        | What                                                         | If missing                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `tsconfig.json`, `src/web/tsconfig.json`     | `customConditions: ["development"]`                          | tsc resolves aliases into `dist/` and type-checks a stale build                                            |
| `.dependency-cruiser.cjs`                    | `enhancedResolveOptions.conditionNames`, `development` first | aliases resolve to `dist/core/*.ts`, so path rules stop matching and every boundary check passes blindly   |
| `vitest.config.ts`, `src/web/vite.config.ts` | `resolve.conditions`                                         | tests and the web build read `dist/`; contracts are type-only so `dist/contracts/*.js` is just `export {}` |
| `dev` script                                 | `tsx watch --conditions=development`                         | tsx reads a stale `dist/` and src edits do nothing                                                         |

Aliases cannot be used to dodge a boundary — a `#core/…` import from `src/web` still fails
`web-only-contracts`.

## Two load-bearing options

Both live in `.dependency-cruiser.cjs`. Removing either makes the guardrails pass while enforcing
nothing:

- **`parser: "tsc"`** — the default parser (acorn) emits no dependency edge for `import type`. These
  boundaries are almost entirely type imports, since contracts are types. Measured on this repo:
  acorn sees 4 dependencies and 0 type-only edges; tsc sees 8 and 4.
- **`conditionNames` starting with `development`** — see the alias table above.

Both mean TypeScript stays inside the range dependency-cruiser declares (`>=2.0.0 <7.0.0` at 18.2.0),
which is why `typescript` is pinned exactly rather than with a caret. Revisit when that range widens.

## Stack

| Area             | Decision                                                         | Note                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime          | Node 24.18.0                                                     | pinned exactly in `.nvmrc` and `engines`                                                                                                                                                                                                                                                                                                                                                                                                     |
| Package manager  | pnpm 11.22.0                                                     | pinned in `packageManager`                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Language         | TypeScript 6.0.3, strict-max, pinned exactly                     | see above                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| SQLite           | `node:sqlite` (`DatabaseSync`)                                   | no native module, nothing to compile on install                                                                                                                                                                                                                                                                                                                                                                                              |
| Transport        | Hono only: POST for ingestion and intents, SSE for world updates | No WebSocket — the problem is one-directional push plus low-frequency commands, which is exactly SSE plus POST. `EventSource` reconnects and replays `Last-Event-ID` for free, which is otherwise hand-written backoff. `hono/streaming` ships `streamSSE`, so this costs no dependency. No Hono RPC either: `hc<typeof app>` would force web to import server types, breaking `web-only-contracts`. Type safety travels through `contracts` |
| Web              | Vite, React, Zustand                                             | renderer starts as plain SVG/DOM; PixiJS only if a profiler proves >30 actors is a real problem                                                                                                                                                                                                                                                                                                                                              |
| CSS              | plain CSS plus CSS Modules                                       | no Tailwind. Tokens for state, station, and motion live in `src/web/styles.css`; the world positions by `transform` computed from `WorldState`, where utility classes buy nothing                                                                                                                                                                                                                                                            |
| Assets           | SVG `<symbol>` sprites, original or MIT/CC0/Apache-2.0           | vectors survive 125–200% zoom. No AGPL or non-commercial: there is a paid surface                                                                                                                                                                                                                                                                                                                                                            |
| Animation        | CSS transitions and keyframes, Web Animations API                | every duration reads `--dur-*`, which `prefers-reduced-motion` zeroes in one place                                                                                                                                                                                                                                                                                                                                                           |
| Tests            | Vitest                                                           | fixture replay is the first-class citizen. `passWithNoTests` is deliberately off                                                                                                                                                                                                                                                                                                                                                             |
| Lint             | oxlint, prettier, dependency-cruiser, `tools/guards.mjs`         | oxlint suffices because tsc carries type-checking. No SWC: dependency-cruiser's swc parser also misses type-only edges, and `@vitejs/plugin-react` already transforms via oxc/rolldown with no Babel                                                                                                                                                                                                                                         |
| License          | FSL-1.1-MIT                                                      | source-available, converts to MIT after two years                                                                                                                                                                                                                                                                                                                                                                                            |
| Dependency bumps | never a version under 24 hours old                               | pnpm quarantines them. Forcing one writes `minimumReleaseAgeExclude` into `pnpm-workspace.yaml` — seeing that list means something bypassed the gate                                                                                                                                                                                                                                                                                         |

## Transport

| Direction      | Endpoint                | Payload                                   |
| -------------- | ----------------------- | ----------------------------------------- |
| hooks → server | `POST /event`           | provider hook payload                     |
| server → web   | `GET /api/stream` (SSE) | one `snapshot` event, then `patch` events |
| web → server   | `POST /api/intents`     | a `UserIntent`                            |

The stream sends `{type:"snapshot", world}` first, then `{type:"patch", ops}`. Patches start as
replace-by-key; optimize later. A reconnect always starts over with a full snapshot, so the client
never has to merge across a gap.

Neither `EventSource` nor `WebSocket` can set request headers from a browser, and a token in the
stream URL would land in access logs. So the stream authenticates with a single-use ticket: the web
app POSTs its real token (headers work fine on `fetch`) to `/api/stream-ticket`, gets a ticket valid
for 30 seconds, and puts that in the SSE URL. The long-lived token never appears in a URL.

There is no RPC client. `WorldState` and `UserIntent` come from `#contracts/*` on both sides, so the
two ends share the same types without web ever importing from server. The cost is that route paths
and methods are not type-checked; the gain is that a new renderer is just another client of the same
`WorldState`.

## Working in parallel

| Zone                                     | Owner           |
| ---------------------------------------- | --------------- |
| `src/adapters`, `src/core`, `src/server` | agent A         |
| `src/web`                                | agent B         |
| `src/contracts`, `docs`, config          | repo owner only |

Contract changes: the agent stops, proposes a diff, waits for approval, then both agents re-read
`AGENTS.md`. Before the server exists, zone B develops against a mock `WorldState` fixture so the
two zones never block each other.

Two subagents live in `.claude/agents/`. Claude Code loads them directly; other tools can read the
same files as role prompts.

| Agent      | Model  | Job                                                             | Access         |
| ---------- | ------ | --------------------------------------------------------------- | -------------- |
| `coder`    | small  | one already-specified change inside one zone, then `pnpm check` | read and write |
| `reviewer` | medium | review a diff against these rules plus correctness              | read only      |

`coder` has hard stops it must report rather than work around: needing a `contracts/` edit, a new
dependency, two zones, a fixture that does not exist, an invented signal, or a loosened rule.
Stopping at one is a success; routing around it is the only real failure.

## Commands

| Command        |                                                                               |
| -------------- | ----------------------------------------------------------------------------- |
| `pnpm dev`     | server (tsx watch) and web (vite) in parallel                                 |
| `pnpm check`   | tsc for both projects, oxlint, dependency-cruiser, pure-zone guards, prettier |
| `pnpm test`    | vitest                                                                        |
| `pnpm build`   | `tsc -p tsconfig.build.json` then vite build                                  |
| `pnpm capture` | hook capture on :7777 into `tests/fixtures/raw/hooks.jsonl`                   |

`pnpm check` also runs as a pre-commit hook via `git config core.hooksPath .githooks`. That is
opt-in per clone, so `.github/workflows/ci.yml` runs check, test, and build on every push and pull
request — that job is the only enforcement guaranteed to happen.
