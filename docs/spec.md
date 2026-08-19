# Pockrew — Working Spec

Condensed reference for anyone writing code here. The full product spec is not in this repo; this
file is the contract you are held to.

## What it is

A local-first supervisor for AI coding agents. It watches what Claude Code and Codex actually do,
turns that into one canonical event stream, and renders a world you can glance at: who is working,
who needs you, what shipped. No network, no account, no cloud.

Every feature must serve one of five pillars, or it does not ship:

| Pillar          | User value                            | Core artifact         |
| --------------- | ------------------------------------- | --------------------- |
| Live Reflection | what the swarm is doing right now     | `WorldState`          |
| Outcome Memory  | what actually got finished            | `WorkReceipt`         |
| Attention       | when a human is needed                | `AttentionItem`       |
| Return          | context restored on coming back       | Shift Report          |
| Safety          | avoid collisions and misleading state | evidence + confidence |

## Principles

1. **Never fake.** No invented conversation, task, completion, or relationship without a real signal.
2. **Outcome is not activity.** Twenty tool calls is not twenty things done.
3. **Evidence before copy.** Every receipt names the signal that produced it.
4. **Confidence is explicit.** `verified`, `observed`, `inferred` never render identically.
5. **Glanceable first, inspectable second.** The world answers "what happened"; panels answer "why".
6. **Attention is selective.** Not every tool failure is a notification.
7. **Local-first for real.** No required network, account, or cloud.
8. **Progression comes from real outcomes only.** Never from tokens, runtime, or tool-call counts.
9. **Role and activity are different.** A "Coder" may be researching. The character follows current
   activity; no classifier reassigns its job.
10. **Unsupported renders as unknown.** Never guess to make the world look livelier.

## Actor lifecycle

States, in precedence order — the higher one wins when signals conflict:

`waiting_user` > `blocked` > `working` > `thinking` > `completed` > `idle` > `ended` > `unknown`

`starting` is the entry state on session discovery.

Default timers, configurable per adapter capability — never one heuristic for every provider:

- Activity runs past its window with no end → `unknown`. Never assume completion.
- 45s with no signal in an open turn → `thinking` holds only while the provider still reports the
  process alive, otherwise `unknown`.
- 60s idle on a live session → `idle`.
- `completed` celebrates for 8s, then `idle` unless a new event arrives.
- `ended` holds 10s so the exit is visible; history survives.

## Confidence

| Level      | Meaning                                                                       | Example                                        |
| ---------- | ----------------------------------------------------------------------------- | ---------------------------------------------- |
| `verified` | outcome checked against an exit code, git state, or explicit completion event | test exits 0; commit hash exists               |
| `observed` | the provider says it happened; content unverified                             | subagent stop; turn stop                       |
| `inferred` | derived from timing, text, or pattern                                         | thinking after a prompt; stalled after timeout |

`inferred` never appears in the "Shipped" section without other evidence. When coverage was
interrupted, the Shift Report must say activity may be missing.

## Work Receipts

An immutable record of a meaningful outcome or checkpoint. Survives restart. The unit that builds
the Shift Report and progression.

| Kind                            | Condition                                                    | Default confidence |
| ------------------------------- | ------------------------------------------------------------ | ------------------ |
| `task_completed`                | explicit task-completed event                                | verified           |
| `subagent_returned`             | subagent or child completion                                 | observed           |
| `turn_completed`                | main turn stop with a final message                          | observed           |
| `test_passed` / `test_failed`   | recognized test command exits 0 / non-zero                   | verified           |
| `build_passed` / `build_failed` | recognized build command exits 0 / non-zero                  | verified           |
| `commit_created`                | HEAD changed and the hash is verifiable                      | verified           |
| `failure_recovered`             | same category failed then passed within one turn             | verified/observed  |
| `review_ready`                  | turn completed with file changes or an explicit ready signal | observed           |

If the provider emits no native completion event, `task_completed` drops to `observed` and derives
from readable task state or turn stop plus git evidence. Never keep the `verified` label without the
native signal.

**Not receipts:** individual Read/Edit/Bash calls, tokens consumed, a session going idle, the word
"done" without a completion signal, a file touched with no checkpoint. A file touch is evidence, not
success.

### Derivation

Receipt rules are pure functions over canonical events plus read-only local evidence:

1. `task_completed` event → verified task receipt.
2. `subagent_completed` → observed subagent receipt, using the provider's final summary if given.
3. Session or turn stop → observed turn receipt. Never call it "shipped".
4. Recognized test/build command plus exit code → verified pass/fail receipt.
5. At turn end, read-only `git rev-parse HEAD` and `git status --porcelain`. Attribute
   `commit_created` to an actor only when that actor has a commit command or event and the HEAD
   change matches; otherwise record it as a project-level change.
6. Fail then pass in the same category within a turn → recovery receipt.

Classify only unambiguous command prefixes: `npm test`, `pnpm test`, `pytest`, `cargo test`,
`go test`, common build scripts. An unknown command gets no test or build outcome.

Summaries truncate to 160 characters in the world and report; full text lives in the inspector.
Users can mark a receipt reviewed; the original evidence is never editable.

## Attention queue

| Type           | Trigger                                       | Default priority |
| -------------- | --------------------------------------------- | ---------------- |
| `approval`     | permission request                            | high             |
| `question`     | agent asks the user                           | high             |
| `error`        | API or tool failure that did not self-recover | high             |
| `stalled`      | no progress past threshold                    | normal           |
| `conflict`     | two active actors touching the same risk area | high/normal      |
| `ready_review` | verified or observed output ready             | normal           |
| `coverage_gap` | adapter disconnected or events missed         | info             |

Priority follows the need for user action and the confidence, never the number of tool failures.

Lifecycle: `open → acknowledged → resolved`, with `open → snoozed → open`, and `open → expired`
only once the provider request is genuinely no longer valid.

**Dedupe:** one permission request is one idempotent item. Repeated failures for the same
actor/category within 5 minutes update the existing item instead of spawning new ones. One conflict
item per pair and path until the overlap ends. One OS notification per item; a repeat after 10
minutes only while the item is still high priority.

**Approval safety:** no auto-approve, ever. Show direct approve/deny only when the adapter declares
it can respond and the request is still alive. Display actor, project, tool, and a sanitized request
summary before any decision. Default timeout 45s, after which the decision returns to the native
terminal. Decisions are idempotent — a double click sends one response. Every decision writes local
audit evidence.

## Conflict detection

Early warning only. Never lock or edit code.

| Rule                                                                       | Severity | Confidence        |
| -------------------------------------------------------------------------- | -------- | ----------------- |
| two active actors write the same canonical file within 10 minutes          | high     | verified/observed |
| two active actors in the same worktree and top-level directory             | normal   | inferred          |
| one actor repeatedly rewrites a file another just changed                  | high     | observed          |
| two actors in different worktrees of one repo touch the same relative path | normal   | inferred          |

Track only relative path, actor, timestamp, and operation — never file contents. Resolve when the
actor or turn ends, or after 10 minutes with no overlap. Alert once per pair, path, and window.
Medium or inferred conflicts send no OS notification by default. Never claim a merge conflict
without a real Git conflict; the wording is "overlapping work".

## Shift Report

Generated when the window reconnects after at least 10 minutes hidden, when the user opens "since I
left", or on restart with new events since `lastSeenAt`.

Window is `from = lastSeenAt` (or a user-chosen cursor) to now. Sections, in order:

1. **Needs You Now** — open approvals, errors, conflicts.
2. **Shipped** — verified receipts only.
3. **Completed Activity** — observed receipts.
4. **Changed** — project, branch, relative files.
5. **Problems & Recovery** — failures, recoveries, coverage gaps.
6. **Next Actions** — deterministic order: approval > conflict > error > ready review > coverage.

Fully deterministic: receipt titles, actor labels, project names, counts. No LLM, no invented
narrative. With no verified outcomes it says exactly that — "Agents were active, but no verified
outcome was captured." Closing the report moves the cursor; it never deletes receipts or attention.

## World mapping

| Data                      | World entity                                 |
| ------------------------- | -------------------------------------------- |
| the whole machine         | one company                                  |
| project or repository     | district                                     |
| main session or subagent  | character                                    |
| current activity category | station                                      |
| attention queue           | HQ / boss desk                               |
| work receipts             | warehouse deliveries                         |
| error or conflict         | smoke or fire, always with an icon and label |
| verified milestone        | construction, cosmetic only                  |

Activity to station: research → library, code → workshop, terminal → lab, review → review room,
coordination → HQ. Waiting on the user → boss desk. No signal → lounge.

Milestones trace back to verified receipt counts only: first verified receipt, then 10, 50, and 200
verified receipts, plus a badge at 10 `failure_recovered` receipts. No coins, XP, or shop.

## Accessibility

Status is colour plus icon plus label, never colour alone. Reduced-motion mode turns movement into
a short fade or a teleport that keeps context. The canvas has a list mirror for keyboard and screen
readers. New attention uses a polite live region; high-priority permissions may be assertive.
Interactive targets are at least 40×40 CSS px. Never auto-pan away from keyboard focus. The world
stays usable at 125–200% zoom.

## Contracts

The runtime types live in `src/contracts/` and are frozen. Two boundaries matter:

- `AgentEvent` — between adapters and core. A new adapter writes a mapper; core does not change.
- `WorldState` plus `UserIntent` — between core and web. A new renderer is a new client of the same
  `WorldState`; core does not change.

Transport is `POST /event` for hooks, `GET /api/stream` (SSE) for world updates, and
`POST /api/intents` for commands. No WebSocket and no RPC client: the types are shared through
`#contracts/*` on both sides, so web never imports from server.

Event rules: `dedupeKey` is unique in the DB. Raw payloads exist only in opt-in debug capture;
production stores normalized fields only. Events can arrive out of order — the reducer relies on
`occurredAt`, precedence, and request ids, not arrival order. An unknown tool maps to terminal or an
unknown activity and never crashes. Summaries are sanitized, truncated, and stripped of secrets and
absolute paths before persisting.

## Persistence

Default database `~/.pockrew/company.sqlite`, via Node's built-in `node:sqlite`. Tables: `projects`,
`actors`, `events`, `receipts`, `attention`, `file_touches`, `milestones`, `app_state`.

Migrations are transactional, with a backup before anything destructive. Default retention is 7 days
for events and file touches, except that nothing between `lastSeenAt` and now is cleaned up until
the user has opened the matching Shift Report. Lifetime milestone counters are independent of event
retention — cleaning history never makes the company lose a level. Cleanup never removes open
attention. The world rebuilds from the DB plus live sources; coordinates are not persisted.

## Source coverage

**Claude Code, stable hooks:** SessionStart/SessionEnd, UserPromptSubmit, PreToolUse/PostToolUse,
Notification, Stop, SubagentStop, PreCompact.

**Claude Code, assumed hooks — verify against the installed version before anything depends on
them:** PermissionRequest as its own hook, SubagentStart, TaskCompleted, PostToolUseFailure,
StopFailure, worktree events. Each needs a real captured fixture first. Missing means the fallback
applies and the receipt drops to `observed`. JSONL backfill is for recovering missed data only.

**Codex, basic adapter:** session discover/start/end, activity category, file touches if a signal
exists, completion receipts at an honest confidence, approvals only if the installed version
supports them and a fixture confirms it. No parity promise. If no trustworthy lifecycle signal
exists, ship Claude-only and label Codex experimental — never infer Codex state from unverified
data. The adapter health screen shows real capabilities.

UI decisions read `capabilities` off the adapter. Never write a provider condition in the renderer.

## Security and reliability

Bind `127.0.0.1` by default. LAN binding happens only while mobile pairing is on, always with a
token, always confirmed on the desktop via QR or a 6-digit code that expires in 2 minutes. Never
bind beyond the LAN, never touch UPnP or port forwarding. Pick a free port and write it to an
owner-only `~/.pockrew/server.json`; the hook shim reads the registry each invocation rather than
hardcoding a port. The token is stored `0600` and passed to the browser in the URL fragment so it
stays out of server logs. Every endpoint requires the token, with an origin allowlist for the local
app only. Single-instance lock, with safe cleanup of a stale registry.

The SSE stream is the one place a token cannot travel in a header, since `EventSource` cannot set
one. It authenticates with a single-use ticket instead: POST the real token to `/api/stream-ticket`,
receive a ticket valid for 30 seconds, and put that in the stream URL. The long-lived token never
appears in a URL or an access log.

Setup parses config, never string-replaces blindly. It backs up before writing, writes atomically
via temp file and rename, stays idempotent across repeat runs, and preserves unknown keys and other
apps' hooks. Uninstall removes only entries carrying Pockrew's own marker.

On reconnect the server sends a full `WorldState` snapshot before any patches — the client never
merges across a gap. `EventSource` handles the reconnect and replays `Last-Event-ID` itself. Malformed events are
logged redacted and skipped, never fatal. JSONL cursors persist so nothing reprocesses from scratch.
A busy or corrupt DB surfaces a coverage gap with repair guidance and never silently resets. Actor
liveness cleanup prevents a character stuck "working" forever.

**Daemon honesty.** Permission requests that arrive while the daemon is down are lost permanently —
they come over hooks with no transcript to backfill. Activity is recoverable from JSONL. On startup,
compare the last stored timestamp against now, record `coverage_lost`/`coverage_restored`, and make
the Shift Report distinguish "nothing happened" from "I was not running", listing the blind window.

## Budgets

| Budget                            | Target                                         |
| --------------------------------- | ---------------------------------------------- |
| hook event to rendered state, p95 | < 750 ms                                       |
| full snapshot, 25 actors          | < 200 KB                                       |
| idle CPU                          | < 3%                                           |
| active CPU, 20 actors             | < 8%                                           |
| memory                            | < 300 MB                                       |
| startup to world                  | < 3 s warm                                     |
| soak                              | 8 h, 20 actors, 10k events, no crash or freeze |

## Required tests

Adapter fixtures to canonical events. Reducer against out-of-order and duplicate events. Receipt
confidence and evidence per signal. Attention dedupe, snooze, resolve, expire. Conflict alerts once
for the same file and never for unrelated ones. Shift report window, verified vs observed
separation, next-action order. Setup installed twice then uninstalled, leaving unrelated config
intact. Integration replay from fixture stream to DB to `WorldState` to UI. Security: a request with
no token or a foreign origin is rejected. Soak: a long replay catches frozen actors and leaks.

Test the contracts and the trust-building logic first. No large per-component snapshot suite.

## Scope

**Must ship:** one-command start/setup/doctor/uninstall; full Claude adapter; basic Codex adapter if
the capability gate passes; one world with districts, characters, and semantic stations; spawn,
activity movement, and Needs You moments; SQLite persistence; work receipts; shift report; unified
attention queue; same-file conflict warning; privacy-safe share card; local security controls;
responsive LAN mobile companion with pairing.

**Cut in this order if late:** direct approval response (keep focus-terminal) → rich Codex
activity parity (keep basic lifecycle) → directory-level conflict (keep same-file) → share
animation (keep the static card) → pretty pathfinding (keep semantic fade) → inspector event detail
(keep receipt and attention detail) → pretty pairing UX (keep URL plus manual token).

**Never cut:** setup safety, state honesty, receipts, shift report, needs-you, persistence.

**Not in the MVP:** autonomous orchestration, task assignment or kanban, token/cost dashboards,
productivity scoring, LLM summaries, cloud sync, remote control, shared team worlds, theme editors,
marketplaces, sound, a generic agent SDK, more than two adapters.
