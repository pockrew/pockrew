# Adapters (`src/adapters/`)

> Sources: `claude/{install,mapper,shim}.ts`, `codex/rollout.ts`. Last verified: 2026-08-21.

Four thin files, zero business logic — adapters wrap, `core/normalize.ts` interprets. Imports:
contracts only (shim imports nothing from the project at all, by design).

## claude/install.ts — safe settings writer

`planInstall` / `install` / `uninstall` / `claudeSettingsPath` / `shimCommand` /
`MARKER = "pockrew-hook-v1"`. Registers 12 hook events (SessionStart/End, UserPromptSubmit,
Pre/PostToolUse, PostToolUseFailure, Notification, Stop, SubagentStart/Stop, TaskCompleted,
PermissionRequest) as `{type:"command", command: node "<shim>" # marker, async:true}`, no
matcher. Safety: JSON parse (never string-replace), backup copy before write, atomic
tmp+rename, per-event marker gate makes install idempotent; uninstall filters only
marker-bearing entries so foreign hooks survive, and iterates existing keys so dropped hook
names still get cleaned. Known sharp edges: corrupt settings.json throws uncaught from
`readSettings`; same-ms backups overwrite; these free functions do NOT implement the
`AgentAdapter` contract interface (nothing does — [gaps-and-debt](gaps-and-debt.md)).

## claude/mapper.ts — 10 lines

`fromHookPost(payload, receivedAt) → RawSourceEvent` `{source:"claude", channel:"hook", …}`.
Never throws; garbage becomes a RawSourceEvent that `normalize` rejects. The hook→kind mapping
lives downstream in `normalizeClaudeHook` — table in [core-pipeline](core-pipeline.md).
PreCompact + unknown hooks map to nothing rather than guessing.

## claude/shim.ts — the per-hook subprocess

stdin → read `~/.pockrew/server.json` fresh each invocation (port never hardcoded) → POST
`/event` with `x-pockrew-token`, 1.5s timeout → **always exit 0** (`.catch(()=>{})`), because a
broken Pockrew must never break the user's Claude session. Corollary: silent loss, no retry, no
response-status check — `pockrew doctor` is the only place a broken shim surfaces.
⚠️ Setup requires a prior `pnpm build`: `cli.ts::shimPath()` rewrites `/src/` → `/dist/` in the
resolved path (tsx runs from `src/`, which holds only `.ts`) and throws if the built shim is
missing.

## codex/rollout.ts — wrapper only, not wired

`fromRolloutLine(line, originRef, receivedAt) → RawSourceEvent | null` (null on malformed
JSON). **No watcher/tailer exists anywhere in src** — the daemon ingests Claude hooks only;
this function is called only from tests. `coverage.ts` hardcodes the honest label
(`CODEX_OFFLINE`). Codex confidence is capped at `observed` downstream. Dedupe nit: codex tool
events key on `receivedAt`, so replaying the same file under a different clock duplicates rows.
Session path shape (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`) exists only in a comment.

## Fixtures backing this layer

`tests/fixtures/claude/hooks-v2.1.235.jsonl` (67 events, incl. permission flow),
`…-recovery.jsonl` (fail→fix→pass→commit), `codex/rollout-v0.148.jsonl`, plus raw captures.
Rule: no pipeline change without a fixture test; capture new ones with `pnpm capture`.
