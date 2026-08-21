# Testing, tooling, CI

> Sources: `package.json`, `tests/**`, `tools/**`, `.dependency-cruiser.cjs`,
> `tools/guards.mjs`, `.githooks/`, `.github/workflows/ci.yml`. Last verified: 2026-08-21.

## Scripts

| Command        | Runs                                                                                                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`     | tsx watch server (`--conditions=development`) + vite, concurrently                                                                                                                 |
| `pnpm check`   | tsc ×2 (server + web projects) → oxlint → depcruise → `tools/guards.mjs` → prettier --check. Pre-commit hook (opt-in `core.hooksPath .githooks`); CI is the guaranteed enforcement |
| `pnpm test`    | vitest run (`src/**/*.test.ts` + `tests/**`)                                                                                                                                       |
| `pnpm build`   | `tsc -p tsconfig.build.json` then vite build → `dist/` (required before `pockrew setup` — shim path)                                                                               |
| `pnpm capture` | hook-capture sink on `CAPTURE_PORT` (default 7777) → `tests/fixtures/raw/hooks.jsonl`                                                                                              |

Deps (all pre-approved, no additions without owner): hono, @hono/node-server, chokidar, immer,
@hugeicons/react + core-free-icons; dev: typescript 6.0.3 (pinned exactly — depcruise range),
vite, react 19, zustand, vitest, tsx, oxlint, dependency-cruiser, prettier(+sort-imports),
concurrently.

## Fixtures (`tests/fixtures/` — "the most valuable asset here")

`claude/hooks-v2.1.235.jsonl` (67 events incl. permission flow) · `claude/…-recovery.jsonl`
(fail→fix→pass→commit) · `codex/rollout-v0.148.jsonl` · `raw/*` unprocessed captures. Rule:
every pipeline change tests against these; missing fixture ⇒ capture first, never guess a
payload.

## Test map (server/core, `tests/`)

| File                     | Proves                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `sqlite-driver.test.ts`  | pinned Node's `node:sqlite` does WAL/transactions/unique errors                                                |
| `store.test.ts`          | idempotent persistence, in-place migration then no-op reopen, layout rows never move                           |
| `normalize.test.ts`      | both fixtures → canonical events; exit codes; truncateSummary                                                  |
| `reduce.test.ts`         | state machine over fixture + synthetic; waiting_user survives ended-mask                                       |
| `receipts.test.ts`       | fixture receipts; recovery fixture → `failure_recovered`                                                       |
| `world.test.ts`          | naming honesty (never invented, ambiguous spawn not guessed), station map, stale ⇒ unknown, 1 request = 1 item |
| `town.test.ts`           | deterministic placement, HQ center, pinned literal = twin-drift guard                                          |
| `ingest.test.ts`         | endpoint security, replay through restart, heartbeat, store failure ⇒ degraded not silent                      |
| `stream.test.ts`         | ticket security, snapshot-then-patch, decay reaches clients, outage never looks calm                           |
| `layout.test.ts`         | attachLayout persistence, built cells never move, failed write never claims a cell                             |
| `registry.test.ts`       | free port, 64-hex token, 0600, refuses second live instance                                                    |
| `claude-install.test.ts` | setup preserves foreign keys/hooks, idempotent, uninstall only ours                                            |
| `attention.test.ts` (M4) | dedupe/streak, stalled, lifecycle, overlayForIntent, notification rate limit                                   |
| `intents.test.ts` (M4)   | `POST /api/intents` + ingest→notification wiring                                                               |

Web tests live beside source — list in [web](web.md).

Replay harness: none shared — each test file re-declares `CaptureLine` + a local `replay*`
(readFileSync → split → `normalize(fromHookPost(...))`). Duplicated across 6 files; candidate
for one `tests/replay.ts` when someone is in there anyway.

## Guards

depcruise (all error): contracts-imports-nothing, core-stays-pure, adapters-only-contracts,
web-only-contracts, server-not-web-source, no-circular, pure-zones-no-store,
sqlite-only-in-store, pure-zones-no-io, web-no-node-builtins. Load-bearing options:
`parser: "tsc"` (acorn drops `import type` edges ⇒ rules pass blindly) and `conditionNames`
starting `development` (else aliases resolve into `dist/`). Never remove either.

`tools/guards.mjs`: bans `Date.now(`/`new Date(`/`Math.random(`/`performance.now(` under
`src/core/{reduce,receipts,attention,conflicts,reports}/**` only — note `normalize.ts`,
`world.ts`, `town.ts` are outside the glob (pure by convention, see
[gaps-and-debt](gaps-and-debt.md)).

tsconfig: strict-max (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`verbatimModuleSyntax`…), NodeNext, `customConditions: ["development"]`; web has its own
project. CI (`ci.yml`): frozen-lockfile install → check → test → build on every push/PR.
