# Overview

> Sources: `docs/spec.md` (product contract), `docs/architect.md` (shape), `docs/roadmap.md`.
> Last verified: 2026-08-21, commit `31c9c61` (M4 merged to main).

Pockrew is a local-first supervisor for AI coding agents: it ingests real signals from Claude
Code hooks (and, later, Codex JSONL), reduces them into one canonical event stream, and renders
a living "company world" (districts = projects, characters = sessions, stations = activity).
Five pillars gate every feature: Live Reflection, Outcome Memory, Attention, Return, Safety.
Cardinal rule: **never fake a signal** — unknown renders as unknown, confidence is explicit
(`verified` > `observed` > `inferred`).

## Where the project stands

| Milestone                                                                             | Status                                  |
| ------------------------------------------------------------------------------------- | --------------------------------------- |
| M0 fixtures/contracts, M1 ingestion+setup, M2 store/reducer/receipts, M3 visual world | done (committed)                        |
| M4 "Needs You" attention queue + OS notify                                            | done (committed `31c9c61` on main)      |
| **M5 shift report + conflicts**                                                       | **started on `feat/m5` (empty branch)** |
| M6 hardening, M7 release v0.1                                                         | pending                                 |

## One-paragraph data flow

Hook POST → `adapters/claude/mapper.ts` wraps → `core/normalize.ts` sanitizes into `AgentEvent`
→ `core/store` (SQLite, `INSERT OR IGNORE` on `dedupeKey`) → on insert, `server/stream.ts`
rebuilds: `assembleWorld(listEvents(), now, coverage, overlays)` (pure) → `attachLayout` (IO:
persisted town/world cells) → diff by top-level key → SSE snapshot-then-patch → web Zustand
store applies. Web sends back only `UserIntent` via `POST /api/intents`. Full detail:
[core-pipeline](core-pipeline.md), [server](server.md).

## Layer map (machine-enforced, see architect.md)

`contracts` (frozen, imports nothing) ← `adapters` / `core` ← `server` → serves `web/dist`.
Pure zones `core/{reduce,receipts,attention,conflicts,reports}`: no IO, no clock, no store.
Cross-layer imports only via `#contracts/…` etc. subpath aliases with `.js` extension.

## Working rules that bite

- `pnpm check` before every commit; `src/contracts/` frozen; no new deps; zone ownership
  (A: adapters/core/server, B: web, owner: contracts/docs/config) — all in `AGENTS.md`.
