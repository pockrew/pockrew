# Store (`src/core/store/store.ts`)

> Source: the file (working tree — v3 migration is uncommitted M4 work); `docs/spec.md`
> §Persistence. Last verified: 2026-08-21.

The only IO module in core. `node:sqlite` (`DatabaseSync`), no native dep. Default DB
`~/.pockrew/company.sqlite` (`POCKREW_DB_PATH` overrides). WAL, `busy_timeout` 5000.
`openStore(dbPath)` returns a closure of prepared statements; `type Store =
ReturnType<typeof openStore>`.

## Schema by migration (`PRAGMA user_version`, each in its own transaction)

| Version              | Adds                                                                                                                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1                   | `events(dedupeKey PK, occurredAt, projectId, sessionId, actorId, kind, json)` + occurredAt idx; `receipts(id PK, occurredAt, json)` + idx; `attention(id PK)`; `app_state(key PK, value)`; stubs `projects`, `actors`, `file_touches`, `milestones` |
| v2                   | `town_layout(project_id, station, cell_x, cell_y, placed_at, PK(project_id, station))`; `world_layout(project_id PK, cell_x, cell_y, placed_at)`                                                                                                    |
| v3 (M4, uncommitted) | `attention` gains `status`, `snoozed_until`, `updated_at`; new `intent_audit(received_at, json)` — no PK, append-only, ordered by rowid                                                                                                             |

Migrations are additive-only so far — **add a backup step before the first destructive one**
(comment in file; spec requires it).

## API surface

`insertEvent` (returns true only when a row actually landed — `INSERT OR IGNORE` on dedupeKey
is THE dedupe boundary) · `listEvents({sinceOccurredAt?})` · `countEventsByKind` ·
`insertReceipt`/`listReceipts` · `getAttentionOverlays` (sparse: `WHERE status IS NOT NULL`) /
`setAttentionOverlay` (upsert = idempotent intents) · `appendIntentAudit`/`listIntentAudit` ·
`getAppState`/`setAppState` · `getTownLayouts(projectIds)` (one `IN (…)` query — no N+1) /
`placeStations` · `getWorldLayout`/`placeWorldCells` · `close`.

## Gotchas

- `placeStations`/`placeWorldCells` are `INSERT OR IGNORE` with **no UPDATE path** —
  cell immutability enforced by SQL, not app logic.
- `receipts` table is exercised only by tests; the daemon re-derives receipts every rebuild
  and never persists them. `projects`/`actors`/`file_touches`/`milestones` are dead stubs.
  See [gaps-and-debt](gaps-and-debt.md).
- Overlay read maps `updated_at ?? 0` — a NULL-timestamp row loses to any event in
  `applyOverlay`'s `Math.max`.
- `getTownLayouts` builds placeholders dynamically; SQLite variable limit untreated (fine at
  current scale).
- Store depends on pure zones for **types** (`AttentionOverlay`, `WorldCell`); depcruise
  forbids the reverse direction.
