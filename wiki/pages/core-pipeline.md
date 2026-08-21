# Core pipeline (`src/core/`)

> Sources: `normalize.ts`, `reduce/reduce.ts`, `receipts/receipts.ts`, `attention/attention.ts`,
> `world.ts`, `town.ts`. Store is its own page: [store](store.md).
> Last verified: 2026-08-21 (M4 working tree — attention.ts is new/uncommitted).

## End-to-end (as wired, not as spec'd)

```
POST /event (http.ts) → fromHookPost → normalize() → AgentEvent | null (null = dropped, still 200)
  → store.insertEvent (dedupe boundary: INSERT OR IGNORE on dedupeKey PK)
  → inserted? stream.broadcast() + notifier.check()
rebuild (stream.ts, on-insert + 2s tick, skipped when 0 clients):
  events = store.listEvents()                    // full table every time (known ceiling)
  world  = assembleWorld(events, now, sourceCoverage(events), store.getAttentionOverlays())
             ├ reduceActors(events, now)         → ActorSnapshot[]
             ├ currentActivities(ordered, now)   → ActivityView[] (local to world.ts)
             ├ deriveAttention(ordered, now, ov) → AttentionItem[]
             ├ deriveReceipts(events)            → WorkReceipt[] (recomputed, never persisted)
             └ actorNames / stationFor / milestonesFor
  attachLayout(world, store, now)                // IO half: town/world cells, in server layer
```

There is no `core/pipeline.ts` despite architect.md listing one — `stream.ts::rebuild` is the
orchestrator.

## normalize.ts

`normalize(raw) → AgentEvent | null`; try/catch, never throws. Handles only claude+hook and
codex+jsonl. Key mechanics:

- `occurredAt = receivedAt` for Claude (hooks carry no timestamp — M0 finding); Codex
  task events use `started_at/completed_at × 1000`.
- `dedupeKey` = `id` = `claude:${kindKey}:${sessionId}:${tool_use_id ?? prompt_id ?? receivedAt}`
  — no id ⇒ idempotent only within the same ms.
- `actorId = agent_id ?? sessionId`; `parentActorId` set only when `agent_id` exists (subagent link).
- `projectId = cwd` — a **raw absolute path**, deliberately unsanitized (unlike summaries).
- Exit-code honesty: 0 only when `interrupted === false`; failures parse `/^Exit code (\d+)/`.
- Sentinel: `Stop` and Codex `task_complete` → `activity_completed` with
  `operation: "turn_stop"` (contract is frozen, so a string sentinel, not a kind).
  `reduce.ts` (`isTurnStop`) and `receipts.ts` both match on it.
- Smuggled slots: `SubagentStart.agent_type` rides `summary` (world.ts reads it back);
  Task/Agent tool `description` rides `activity.operation`.
- `Notification` maps only when `notification_type === "permission_prompt"` and shares the
  `attention_approval` dedupe family with `PermissionRequest` (fallback, less detail).
- Only `TaskCompleted` gets `verified`; `approvedByFor` never returns `"human"` (cross-event
  PermissionRequest match unimplemented — see [gaps-and-debt](gaps-and-debt.md)).
- Redaction: credential words matched as whole `[-_]` segments; long-alnum rule needs ≥24 chars
  incl. a digit. `truncateSummary` cuts at 160.

## reduce/reduce.ts — actor state machine

`reduceActors(events, now, timers = defaultTimers) → ActorSnapshot[]` (a `Pick` of `ActorView`).
Timers: thinking 45s, idle 60s, completedHold 8s, endedHold 10s (declared, **never read** —
renderer concern), activityWindow 600s (our default; spec leaves it open).

Precedence in `finalize`: `waiting_user` > `blocked` > derived candidate; `ended` overrides
only `idle`/`starting`/`unknown` (working/thinking/completed outrank it). Candidate order:
open activity (past window → `unknown`/inferred, never assume completion) → open turn
(`thinking` only with valid `process_alive`, else `unknown`) → completed hold → starting/idle.

Gotchas: `process_alive` is heartbeat-only (never touches `lastSignalAt`); one open after
`endedAt` is ignored. `subagent_completed` sets both `completedAt` and `endedAt` (it IS the end
signal — a stopped subagent is never "idle"). `coverage_lost/restored` filtered out pre-fold
(would spawn a fake "daemon" actor). `activity_failed` sets blocked; cleared by next activity
start/complete, **not** by `task_completed`. Sort has no dedupeKey tiebreaker (world.ts and
attention.ts do) — equal-ts events fold in input order.

## receipts/receipts.ts

`deriveReceipts(events) → WorkReceipt[]` sorted ascending. Rules as coded: `task_completed`
(verified) · `subagent_returned` (observed) · `turn_completed` at turn_stop (observed) +
`review_ready` if the turn wrote files · classified Bash + exit code → test/build pass/fail
(verified) · pass clearing a tracked same-category failure → `failure_recovered`.

Gotchas: `matchesPrefix` requires a word boundary (`npm test-fixtures/x` ≠ `npm test`);
interrupted Bash (no exit code) yields no receipt; receipt `id = receipt:${kind}:${dedupeKey}`
(stable re-derivation); events without `turnId` collapse into one bucket per actor
(`review_ready` file sets can cross-contaminate); `commit_created` unimplemented (`ponytail:`
note — needs read-only git IO at server level) though `world.ts` already counts it in
milestones; `WorkReceipt.git` never populated.

## attention/attention.ts (M4, uncommitted)

`deriveAttention(events, now, overlays) → AttentionItem[]`: four folds (requested, error,
activity, coverage) + `stalledItems`, then persisted overlay, drop resolved/expired, sort by
`openedAt` then id. `overlayForIntent(intent, now)` is the pure transition behind
`POST /api/intents` (returns null for non-attention intents).

Constants: `DEFAULT_PRIORITY` (approval/question/error/conflict high; stalled/ready_review
normal; coverage_gap info), `ERROR_STREAK_MS` 5min, `STALLED_AFTER_MS` 10min.

Gotchas: provider items key on `attention.requestId` (two prompts never merge); id-less
`Notification` folds into the actor's existing open item without overwriting the richer
summary. Any later activity from the same actor clears all its open requested items (strict
`>` on timestamps). Error streak updates in place with `×N —` prefix inside 5min, mints a new
id past it — so **an ack is lost when the streak window rolls** (id embeds openedAt). Snooze
repurposes `expiresAt` as wake time; event truth always beats overlay. `conflict` and
`ready_review` have priorities but **no producers** (M5). Known nit: `foldError` clears
streaks by `startsWith(actorId + ":")` — an actorId containing `:` could clear a sibling's.

## world.ts — assembly

`assembleWorld(events, now, coverage, overlays) → WorldState`. Pure (clock/coverage are
parameters) but **outside the guard-enforced zone list** — pure by convention only. Exports
`STATION_BY_CATEGORY` (research→library, code→workshop, terminal→lab, review→review,
coordination→hq) so stream.ts never re-derives it.

Load-bearing logic: **naming honesty** — main actor named by its own first non-system
`prompt_submitted` (skip-and-fallback, never reword); subagent gets its spawn description only
in the unambiguous 1-description×1-subagent case, else `agent_type #N · parent` fallback
(guessing by position = invented relationship, AGENTS §7). `currentActivities` matches
completion to open activity by `tool` equality (no correlation id); past activityWindow →
rewritten `unknown`/inferred, same verdict as the reducer so the pair never disagrees.
`stationFor`: waiting_user → boss_desk; activity + working/thinking/blocked → category
station; else lounge. `needsUser` = open|acknowledged (twin of `web/lib/attention.ts`).
Milestones: verified receipts only, per project, `test/build_failed` excluded ("a failure is
not a delivery"). `RECENT_RECEIPT_LIMIT` 20, `DISPLAY_NAME_LIMIT` 48. `reviewed` hardcoded
false. Never sets `stationCells`/`worldCell` — that's `attachLayout` (server IO).

## town.ts — deterministic placement

`assignCells` (stations, `hq` pinned center) and `assignWorldCells` (projects, lowest id pinned
only on empty board). Signed grid, center (0,0), ring r = annulus `max(|x|,|y|)==r` walked
clockwise from top-left (8r cells). FNV-1a hash seed + linear probe + outward spill; missing
keys sorted internally so caller order never matters. **Both return only NEW placements —
existing cells never move** (growth adds rings, never renumbers). ⚠️ Triplet twin: the same
algorithm is hand-copied in `web/lib/grid.ts` + `world-layout.ts` because web must not import
core — change one, change all three; `grid.test.ts` pins a literal cell to catch drift.
