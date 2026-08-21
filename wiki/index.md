# Pockrew Wiki — Index

Read this file first, then open only the pages the task needs. Pages compile what the raw
sources (`docs/spec.md`, `docs/architect.md`, `src/**`, `tests/**`) do **not** say in one place:
the code-level map, cross-layer flows, gotchas, and what is spec'd but unbuilt. Never edit raw
sources from here; never restate spec/architect content — link to it.

Maintenance workflow (ingest / query / lint) is defined in the project skill
`.claude/skills/wiki/SKILL.md` (invoke `/wiki`).

## Pages

| Page                                    | One-liner                                                                 | Load when                                    |
| --------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------- |
| [overview](pages/overview.md)           | What Pockrew is, milestone status, current branch state                   | every session start                          |
| [contracts](pages/contracts.md)         | The 7 frozen type files — exports, invariants, unconfirmed parts          | touching any shared shape                    |
| [core-pipeline](pages/core-pipeline.md) | normalize → reduce → receipts → attention → world → town, end-to-end flow | any `src/core` work                          |
| [store](pages/store.md)                 | SQLite schema, migrations v1–v3, dead tables, store API                   | `src/core/store` or persistence              |
| [adapters](pages/adapters.md)           | Claude install/mapper/shim, Codex rollout, hook→kind map                  | `src/adapters` or hook coverage              |
| [server](pages/server.md)               | CLI, routes, SSE ticket flow, registry, coverage, notify                  | `src/server` work                            |
| [web](pages/web.md)                     | Component tree, Zustand/SSE wiring, lib helpers, a11y, CSS tokens         | `src/web` work                               |
| [testing](pages/testing.md)             | Test map, fixtures, scripts, guard rules, CI                              | writing/running tests                        |
| [gaps-and-debt](pages/gaps-and-debt.md) | Spec'd-not-built, `ponytail:` ceilings, twin-maintenance traps            | before claiming anything "done" or "missing" |

## Companion tooling

- `.codegraph/` index exists (symbols + call graph). For "where is X / what calls Y" use
  `codegraph explore "…"` before grep — one round-trip instead of a read loop.
- [log](log.md) — append-only journal of every wiki ingest/lint. Check tail for freshness.

Last full ingest: 2026-08-21, commit `854212e` + uncommitted M4 working tree (see log).
