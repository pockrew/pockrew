---
name: wiki
description: Pockrew codebase wiki (Karpathy LLM-wiki pattern) — query it at session start instead of re-reading source, ingest changes into it after merged work or milestone completion, lint it for staleness. Trigger on "wiki", "update the wiki", "wiki ingest", "wiki lint", session-start orientation, before any claim about what exists in the codebase — and AUTO-RUN an ingest whenever the user confirms a commit landed ("đã commit", "committed", "pushed") or the wiki/.stale marker exists.
---

# Pockrew wiki — schema and operations

The wiki at `wiki/` is the compiled knowledge layer between agents and the raw sources. It
exists to cut session-start context cost: read `wiki/index.md` plus only the pages the task
needs, instead of re-reading `src/**`.

## Three layers (Karpathy pattern)

1. **Raw sources** — `docs/spec.md`, `docs/architect.md`, `src/**`, `tests/**`, config.
   The wiki reads them, never modifies them, and never restates them — it links.
   **Gitignored content is out of bounds**: anything `.gitignore` excludes (`docs/.internal/`,
   `tests/fixtures/raw/` contents, local settings) is never a wiki source — do not cite the
   files or restate what they say; the wiki is committed and must stand on committed sources
   only. Naming a path that committed code writes to (e.g. the `pnpm capture` output path) is
   fine. Check `git check-ignore` when unsure.
2. **The wiki** — `wiki/index.md` (catalog, read first), `wiki/log.md` (append-only journal),
   `wiki/pages/*.md` (one page per subsystem + `gaps-and-debt.md`). Agent-owned: create,
   update, cross-reference freely — but every claim must trace to code actually read this
   session or a prior verified ingest. Never write a claim you have not verified (AGENTS §7
   applies to the wiki too).
3. **The schema** — this skill. Conventions and the three operations below.

## Conventions

- Page header: `> Sources: <files>. Last verified: <YYYY-MM-DD>, <commit / working-tree note>.`
- Cross-reference pages with relative markdown links (`[store](store.md)`).
- `index.md` holds one line per page: name, one-liner, "load when". Keep it under ~40 lines.
- `log.md` entries: `## [YYYY-MM-DD] ingest|query|lint | title`, appended at the bottom,
  never rewritten.
- Pages compile what raw sources do NOT say in one place: code-level maps, exact export names,
  gotchas, deliberate traps, spec'd-vs-built deltas. Duplicating spec/architect prose is a
  lint error.
- Companion: `.codegraph/` index answers "where is X / what calls Y" (`codegraph explore`).
  Re-index is automatic per machine; not a wiki concern.

## Operations

**Query** (default, every session): read `index.md`, open only matching pages, work. If
`wiki/.stale` exists, say so and run an ingest first. If the task produced knowledge worth
keeping (a traced flow, a resolved confusion), file it into the right page and log a `query`
entry.

**Ingest** (auto: when the user confirms a commit landed or `wiki/.stale` exists; also after
a milestone lands, a branch merges, or any change that invalidates a page): `wiki/.stale` is
written by the `.githooks/post-commit` hook — one commit hash per line since the last ingest
(gitignored, may be absent on clones without `core.hooksPath` set). Diff that range (or the
commits the user names), re-read only the touched source files, update the affected pages
(typically 1–3), refresh their `Last verified` stamps, update `index.md` one-liners if scope
shifted, append a `log.md` ingest entry naming source commits and pages touched, then delete
`wiki/.stale`. Uncommitted work is ingestable — mark it "working tree" in the stamp.

**Lint** (periodic, or when a page contradicts observed code): sweep pages for stale claims
(check `Last verified` against `git log`), contradictions between pages, broken links, orphan
pages missing from `index.md`, and duplicated raw-source prose. Fix what you can verify,
delete what is wrong, log a `lint` entry listing findings.

## Boundaries

- Wiki edits are normal file edits — no owner approval needed (unlike `docs/` product docs
  and `src/contracts/`).
- The wiki is descriptive, never normative: rules live in `AGENTS.md` and `.claude/rules/`;
  the wiki may point at them, never restate or override them.
- When wiki and code disagree, code wins — fix the wiki, log it.
