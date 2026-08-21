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
