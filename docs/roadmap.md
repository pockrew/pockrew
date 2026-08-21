# Pockrew — Public Roadmap

What we are building and in what order. Dates are not promises; order is. Milestones ship when
their definition of done passes, and every release is gated on real evidence — see
[spec.md](./spec.md) for the principles that never bend (no faked signals, explicit confidence,
local-first).

## Where we are

**Pre-release, v0.1 in development.** Foundation is done: strict layer architecture with
machine-enforced boundaries, frozen event contracts, and — as of 2026-08-19 — real captured
fixtures from Claude Code (2.1.235) and Codex (0.148) sessions, including the full permission
approval flow. Every pipeline feature from here is built and tested against that real data.
As of 2026-08-21 the company world is live and the attention queue works end to end: districts,
characters with real task nameplates and speech bubbles, road-walking movement, crowd folding
with a per-crew roster, and a unified Needs You queue — permission prompts, errors, stalls and
coverage gaps become one deduplicated item each, with OS notifications from the daemon (once per
item, quiet repeat only while it still matters) and acknowledge/snooze/dismiss actions that
survive restarts. Where a provider exposes no way to answer for you, Pockrew says so and focuses
you to the right terminal instead of pretending. Final art continues to land asset-by-asset
without code changes.

## Path to v0.1

| Milestone                | What you get                                                                             | Status  |
| ------------------------ | ---------------------------------------------------------------------------------------- | ------- |
| M0 — Evidence            | Real captured fixtures, verified hook coverage, frozen contracts, renderer decision      | ✅ done |
| M1 — Ingestion + setup   | Local daemon, one-command `setup` / `doctor` / `uninstall` that never breaks your config | ✅ done |
| M2 — Persistence + trust | SQLite store, actor state machine, Work Receipts with honest confidence levels           | ✅ done |
| M3 — Company world       | The visual world: districts, characters, semantic stations, live activity                | ✅ done |
| M4 — Needs You           | Unified attention queue: approvals, questions, errors — one item, one notification       | ✅ done |
| M5 — Shift Report        | "Since you left": shipped vs observed, conflicts, deterministic next actions             | next    |
| M6 — Hardening           | Onboarding, security pass, LAN mobile companion, external testing, 8-hour soak           |         |
| M7 — **Release v0.1**    | Shift Card sharing, docs, package published, first public tag                            |         |

**v0.1 ships:** live world for Claude Code sessions (Codex basic lifecycle, labeled by real
capability), work receipts, shift report, attention queue, same-file conflict warning, SQLite
persistence, LAN mobile companion. All local — no account, no cloud, no telemetry by default.

## After v0.1 — release plan

| Release | Focus                                                                      | Gate                                      |
| ------- | -------------------------------------------------------------------------- | ----------------------------------------- |
| v0.1    | Local validation: live world + receipts + attention + shift report         | M0–M7 definition of done                  |
| v0.2    | Adapter accuracy, Codex parity where signals allow, onboarding fixes       | feedback from first users                 |
| v0.3    | Desktop Pro: permanent history, rich reports, conflict map, session replay | real demand for history/replay            |
| v0.4    | Optional native shell/tray, if browser-local limits retention              | v0.3 learnings                            |
| v0.5    | Remote add-on: attention and approvals away from your LAN                  | proven demand from mobile companion usage |
| v1.0    | Stable local supervisor with proven value                                  | quality bar, not a feature list           |

Between v0.1 and v0.2 the priority is validation, not features: adapter/state correctness first,
then onboarding blockers, report usefulness, and attention noise — in that order.

## Not planned

Autonomous orchestration, task assignment/kanban, token or cost dashboards, productivity scoring,
LLM-generated summaries, cloud sync, shared team worlds, theme marketplaces. Some may come after
v1.0 if real demand shows up; none will come at the cost of the local-first, never-fake principles.
