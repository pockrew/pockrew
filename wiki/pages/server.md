# Server (`src/server/`)

> Sources: `cli.ts`, `http.ts`, `stream.ts`, `registry.ts`, `coverage.ts`, `notify.ts`
> (notify + intents route are uncommitted M4 work). `setup/` holds only a `.gitkeep` — install
> logic lives in `adapters/claude/install.ts`. Last verified: 2026-08-21.

## Routes (`http.ts::createApp`)

| Method/path               | Behavior                                                                                                                                                                            | Auth                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `POST /event`             | mapper → normalize; bad JSON 400; unmappable 200 (logged-and-skipped); `insertEvent` idempotent; new insert ⇒ broadcast + notify; store throw ⇒ mark degraded, still broadcast, 503 | token header                                                |
| `POST /api/intents`       | coerce body → `overlayForIntent`; unmapped kind 400 (`receipt_mark_reviewed`/`report_seen`/pairing are M5/M6); success ⇒ `setAttentionOverlay` + `appendIntentAudit` + broadcast    | token header                                                |
| `GET /api/health`         | one `countEventsByKind` query; degraded payload with repair guidance when `storeFailedAt` set                                                                                       | token header                                                |
| `POST /api/stream-ticket` | real token → single-use ticket, TTL 30s                                                                                                                                             | token header                                                |
| `GET /api/stream`         | SSE, self-authed by ticket (EventSource can't set headers; token in URL would hit logs)                                                                                             | ticket                                                      |
| `GET *`                   | static `dist/web`, mounted only `if (webBuilt())`                                                                                                                                   | none (token rides URL **fragment**, browsers never send it) |

Middleware: token required for `/api*` + `/event` (exemptions: stream, static). Origin
allowlist only when an Origin header is present: `127.0.0.1:{port}`, `localhost:{port}`,
plus `POCKREW_DEV_ORIGIN` — parsed as URL and honored **only** if its hostname is
localhost/127.0.0.1.

## SSE mechanics (`stream.ts`)

Connect: snapshot first (also resets the shared diff baseline), then replace-by-key patches
(`diffOps` = per-key `JSON.stringify` compare). Suppressions: 0 clients ⇒ no rebuild; 0 ops or
only `generatedAt` changed ⇒ silence. 2s tick (unref'd, stops at 0 clients) exists so
time-derived decay reaches clients without new events. Failed write self-drops the client;
rebuild errors are logged, never break ingestion. Two `ponytail:` ceilings — global (not
per-client) diff baseline, and full-table rebuild per event — see
[gaps-and-debt](gaps-and-debt.md).

`attachLayout(world, store, now)`: 2 batch queries (no N+1) → `assignCells`/`assignWorldCells`
→ `tryPersist` (SQLITE_BUSY tolerated: falls back to durable layout rather than claiming an
unsaved cell). Seeds stations from actors **and** recorded activities — the activities term is
load-bearing (a completed activity whose actor decayed to idle must still persist its station).
Built stations are permanent.

## Registry + lifecycle (`registry.ts`, `cli.ts`)

`~/.pockrew/server.json` (dir 0700, file 0600): `{port, token(64-hex), pid, startedAt}`.
`POCKREW_PORT` pins (fails loud if taken); otherwise OS-assigned. Single instance via pid
liveness probe; stale file reclaimed; release only deletes its own pid's file. Known races:
close-then-relisten port probe, pid-file (not flock) lock.

`pockrew start` order (load-bearing): acquire registry → openStore →
`checkDaemonCoverage` **before** writing the new heartbeat (compares against the previous one)
→ heartbeat + 30s refresh → notifier (60s check, `POCKREW_NOTIFY=0` disables) → `createApp` →
`serve` on `127.0.0.1` (hardcoded loopback) → prints `http://127.0.0.1:<port>/#token=<token>`.
Shutdown (SIGINT/SIGTERM, guarded once): clear intervals, final heartbeat (so next start sees
no false gap), close server → store → registry.

`pockrew doctor`: registry → daemon health (2s timeout; degraded = FAIL) → settings contain
MARKER → shim file exists (regex-extracts the path; the shim fails silently by design, so
doctor is where a missing shim surfaces). `pockrew setup`/`uninstall` wrap install.ts and
print the plan + backup path.

## Coverage honesty (`coverage.ts`)

`BLIND_WINDOW_MS` 60s (our number; spec gives none). Gap ⇒ two synthetic events
`coverage_lost@last` + `coverage_restored@now`, both keyed on the **heartbeat** ts so a crash
between inserts stays retryable under `INSERT OR IGNORE`; confidence `inferred`, actor
"daemon". First run / corrupt heartbeat ⇒ never fakes a gap. `sourceCoverage`: store failure ⇒
both sources degraded; last gap event ⇒ degraded; zero events ⇒ offline; healthy only when
events actually arrive — never a default.

## Notifications (`notify.ts`, M4)

`dueNotifications` (pure): open + high/critical only; repeat after `NOTIFY_REPEAT_MS` 10min.
macOS `osascript` only (non-darwin silent no-op); `JSON.stringify` escaping as injection
guard; in-memory log by design (restart ⇒ one fresh ping for a still-open high item is
correct), GC'd against live ids.

## Env vars (all four)

`POCKREW_DB_PATH` (cli), `POCKREW_NOTIFY` (cli), `POCKREW_PORT` (registry),
`POCKREW_DEV_ORIGIN` (http). Web-dev proxy default port 7799 lives in `web/vite.config.ts`.
