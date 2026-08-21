# Gaps and debt — spec'd vs built

> Compiled from full code sweep 2026-08-21 (commit `854212e` + M4 working tree); re-verified by
> the M0–M5 deep audit 2026-08-21 (M5 working tree on `feat/m5`). Read before claiming a feature
> "done" or "missing", and before "fixing" a deliberate trap.

## Spec'd, not implemented

- **Retention (spec §Persistence, roadmap M2) — no cleanup code exists at all.** `events`/
  `intent_audit` grow unbounded; the `lastSeenAt→now` exemption is vacuous. **Latent data-loss
  twin:** milestones are recomputed from the full event replay every rebuild (`world.ts::
milestonesFor`) and the `milestones` table is never written — the day retention lands,
  districts lose their levels unless counters are persisted first. Land the two together.
- **Migration backup before the first destructive migration** — absent (documented in
  `store.ts:15-17`); all three migrations are additive so it is vacuous today, and no guard
  stops a destructive v4 from shipping without it.
- **JSONL tailer/backfill (Claude) + live watcher `~/.codex/sessions` (Codex)** — deferred
  M1→M2 in the roadmap, then dropped from the M2 list; never built. `chokidar` is a declared
  dep imported by nothing. Consequence: spec's "Activity is recoverable from JSONL" is false —
  a blind window is only _recorded_, never backfilled; Codex is fixture-only
  (`CODEX_OFFLINE` labels it honestly).
- **Git IO (one root cause, three symptoms):** `commit_created` receipts (P0 rule 5 of 6,
  `ponytail:` in `receipts.ts`), `WorkReceipt.git`/evidence type `"git"` never populated,
  and the Shift Report "Changed" section's `branch` field omitted. Needs read-only
  `git rev-parse HEAD` + `git status --porcelain` at server level.
- **`core/pipeline.ts`** is listed in architect.md but does not exist — `server/stream.ts::rebuild`
  orchestrates instead.
- **`approvedBy: "human"`**: cross-event PermissionRequest match never built; `normalize`
  returns policy/auto/unknown only, `reduce` never reads the field.
- **`AgentAdapter` interface + `AdapterCapabilities`**: declared in contracts, implemented by
  nothing — no runtime capability gate exists; the attention card _hardcodes_ the Claude
  `approvals:"observe"` assumption in a comment, and the M6 adapter-health screen has nothing
  to read.
- **`THIRD_PARTY_NOTICES.md` is stale and was not updated when assets were vendored (M3):**
  it still says no third-party code/assets are bundled while 10 PNGs + `sprites.svg` ship in
  `dist/web/assets`, and it points at `docs/data-notes.md` (actual: `docs/.internal/`).
  Owner file — flag, don't edit.
- **Conflict detector deliberate cuts**: spec rows 2/4 (directory/worktree, normal/inferred)
  are spec-sanctioned cuts; row 3 (repeated rewrite) is NOT in the cut list but is largely
  subsumed by row 1. Resolve rules built: either actor's session end, BOTH actors' turn_stop,
  or 10 quiet minutes.
- **M3 leftovers**: codex idle art + walkFrames null (SVG fallback), true isometric projection,
  live main+3-subagents demo — parked on the pre-release checklist.
- **Test gaps**: integration replay stops at `WorldState` (nothing drives the React tree); no
  soak/budget check exists (M6 owns the 8h/10k soak — it is also the only thing that would
  catch the two stream.ts ceilings).

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
  `:` could clear a sibling's; contract status `"expired"` is never written — expiry is
  modelled as deletion, so no consumer ever sees the status.
- `notify.ts`: 10-min repeat for open high items sits in wording tension with §Conflict's
  "alert once per pair+path+window" (spec wording issue, not a code bug); the notify filter is
  priority-only — a future high+**inferred** rule would notify despite §Conflict's inferred
  carve-out.
- `cli.ts:68`: the startup URL line prints the token to stdout — in-spec (only _server access
  logs_ are forbidden) but lands in shell transcripts; revisit in the M6 security pass.
- `reduce.ts`: `defaultTimers` is one constant for every provider — spec wants per-adapter
  capability config; moot while Claude-only. `endedHoldMs` declared/never read; `world.ts`
  uses a different 30-min ended-linger instead of the spec'd 10s hold.
- `ReceiptView` drops `evidence`/`files` (keeps `fileCount`) — evidence renders only inside
  the Shift Report; warehouse HUD and actor inspector cannot show it without a contract
  extension.
- `reduce.ts`: sort lacks the dedupeKey tiebreaker that world.ts/attention.ts use.
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
