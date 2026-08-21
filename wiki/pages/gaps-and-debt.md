# Gaps and debt — spec'd vs built

> Compiled from full code sweep 2026-08-21 (commit `854212e` + M4 working tree). Read before
> claiming a feature "done" or "missing", and before "fixing" a deliberate trap.

## Spec'd, not implemented

- **`core/conflicts/` and `core/reports/`** are `.gitkeep`-only. Guardrails (depcruise pure-zone
  rules, guards.mjs globs) already name them; the code lands at M5 (same-file conflict
  detection, Shift Report).
- **`core/pipeline.ts`** is listed in architect.md but does not exist — `server/stream.ts::rebuild`
  orchestrates instead.
- **Codex ingestion**: `fromRolloutLine` exists, **no tailer/watcher anywhere** — daemon is
  Claude-only; `coverage.ts` labels it honestly (`CODEX_OFFLINE`).
- **`commit_created` receipts**: `ponytail:` in `receipts.ts` — needs read-only
  `git rev-parse HEAD` at server level; `world.ts` already counts the kind in milestones.
- **`approvedBy: "human"`**: cross-event PermissionRequest match never built; `normalize`
  returns policy/auto/unknown only, `reduce` never reads the field.
- **Attention producers missing** for `conflict` and `ready_review` types (priorities exist,
  producers land M5); intents `receipt_mark_reviewed`, `report_seen`, `pairing_*` are
  audited no-ops; `ReceiptView.reviewed` hardcoded false.
- **`AgentAdapter` interface + `AdapterCapabilities`**: declared in contracts, implemented by
  nothing — no runtime capability gates exist; install.ts is free functions.
- **M4 remaining**: web drawer deep-focus to actor, approve/deny flow (45s timeout, terminal
  fallback), per spec DoD. M3 leftovers: codex idle art + walkFrames null, true isometric
  projection, live main+3-subagents demo still owed.

## Deliberate ceilings (`ponytail:` marked)

- `stream.ts:127` — **global diff baseline**, not per-client: a late joiner resets it; earlier
  clients can lag on time-only decay until a real event. Upgrade: per-client baselines.
- `stream.ts:148` — **full-table rebuild per event** (`listEvents()` whole window). Trigger to
  go incremental: 750ms p95 budget missed or retention cleanup lands (`sinceOccurredAt` param
  already exists, unused).
- `receipts.ts:193` — commit_created (above).

## Unmarked ceilings / known nits

- `registry.ts`: close-then-relisten port probe (TOCTOU) + pid-file lock — two simultaneous
  `start`s can race.
- `coverage.ts`: store write failure marks **codex** degraded too, though nothing tails codex.
- `attention.ts`: error-item ack lost when the 5-min streak window rolls (new id embeds new
  openedAt); `foldError` clears streaks by `startsWith(actorId + ":")` — actorId containing
  `:` could clear a sibling's.
- `reduce.ts`: sort lacks the dedupeKey tiebreaker that world.ts/attention.ts use;
  `endedHoldMs` declared, never read (renderer concern).
- `receipts.ts`: no-`turnId` events collapse into one bucket per actor — `review_ready` file
  sets can cross-contaminate; `writesByTurn` built over the whole replay, so a turn's receipt
  can list files written after its stop.
- `install.ts`: corrupt settings.json throws uncaught; same-millisecond backups overwrite.
- `shim.ts`: swallows everything incl. HTTP errors — doctor is the only surface; setup needs
  `pnpm build` first (`/src/`→`/dist/` path rewrite in `cli.ts::shimPath`).
- **Guard gap**: `normalize.ts`, `world.ts`, `town.ts` sit at `src/core/` top level — outside
  both guards.mjs globs and depcruise pure-zone rules. Pure by convention only; keep them that
  way (clock/coverage always parameters).
- Dead schema: `projects`/`actors`/`file_touches`/`milestones` tables never touched; `receipts`
  table only tests use (daemon re-derives every rebuild).
- Test debt: replay harness duplicated across 6 test files — fold into `tests/replay.ts`
  opportunistically.

## Twin-maintenance traps (change one ⇒ change all)

- **Grid placement triplet**: `core/town.ts` ↔ `web/lib/grid.ts` ↔ `web/lib/world-layout.ts`.
  Layer rules forbid the import; `grid.test.ts` pins a literal server-produced cell as the
  drift alarm.
- **Open-attention predicate**: `core/world.ts::needsUser` ↔ `web/lib/attention.ts::isOpenAttention`
  (open|acknowledged).
- **`turn_stop` sentinel string**: produced by `normalize.ts` (Stop + codex task_complete),
  matched by `reduce.ts` and `receipts.ts`.
- **Activity window**: `defaultTimers.activityWindowMs` (reduce) and `world.ts::currentActivities`
  must agree, and `attention.ts::STALLED_AFTER_MS` deliberately equals it.

## Deliberate "bugs" — do not fix

- `formatElapsed` sub-minute shows an absolute clock time (server suppresses generatedAt-only
  patches; "just now" would lie).
- `AttentionDrawer` omits `aria-expanded` and keeps the collapsed list mounted (live region
  must not be silenced).
- `travel-state` returns the same object on no-op (backstop re-arm), `StationSlot` fully
  aria-hidden (list mirror announces), `?no-inline` on sprites (`<use href>` can't hit data:
  URIs), React Compiler off (Zustand selectors carry perf), `layout.roadCells` computed but
  unused (future PNG road tiles).
