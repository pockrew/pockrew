# Wiki log — append-only

Chronological record of every ingest, filed query, and lint pass. Newest at the bottom.
Entry format: `## [YYYY-MM-DD] ingest|query|lint | title`.

## [2026-08-21] ingest | Initial wiki build (full codebase sweep)

- Source: full read of `src/**`, `tests/**`, `tools/**`, config, `docs/roadmap.md` at commit
  `854212e` (feat/m4 branch) plus uncommitted M4 working tree (attention engine, notify,
  store v3 migration, intents route).
- Created: index.md, all 9 pages under pages/.
- Also created: `.codegraph/` index (80 files, 1,125 nodes, 2,903 edges) via `codegraph init`;
  DB is machine-local and self-gitignored.
- Schema (operations + conventions) lives in the project skill `.claude/skills/wiki/SKILL.md`
  per owner direction — not in AGENTS.md.

## [2026-08-21] lint | Gitignore boundary pass

- Rule added to schema (skill): gitignored content is never a wiki source.
- Removed `docs/.internal/data-notes.md` citation from pages/adapters.md; removed
  private process notes from pages/overview.md.

## [2026-08-21] ingest | M4 squash landed on main (31c9c61)

Stale range 854212e..31c9c61 = the M4 squash itself; its wiki page updates were committed inside
that commit. Only fix: overview milestone table (M4 done, M5 started on feat/m5) + stamp.
Pages touched: overview. Deleted .stale (4 hashes).

## [2026-08-21] lint | M0–M5 deep audit before closing out M4/M5

Two read-only sweeps (spec-vs-code, roadmap-M0–M4-vs-code) re-verified the whole ledger on the
feat/m5 working tree. Removed stale entries (conflicts/reports built, mark-reviewed + report_seen
real, drawer deep-focus shipped, ReceiptView.reviewed live). Added previously-unlisted misses:
retention absent + milestone-loss twin, migration backup absent, Claude/Codex tailer dropped from
plan (chokidar dep unused), git IO root cause, report restart-trigger missing, blind-window
wording, ready_review producer, TPN staleness, token-on-stdout, expired-status-never-written.
Pages touched: gaps-and-debt.

## [2026-08-21] ingest | M5 gap fixes off the deep audit (working tree, feat/m5)

Fixed: report restart-trigger (mount probe + web/lib/report-news.ts), blind-window honesty
sentence in report UI, ready_review producer (attention.ts off review_ready receipts, dies with
session, cleared by mark-reviewed), conflict resolve on both-turns-ended, positive build receipt
tests. 287 tests green. Pages touched: gaps-and-debt (entries removed), this log.
