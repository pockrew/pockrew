# Contracts (`src/contracts/`) — frozen

> Sources: the 7 files themselves; `docs/spec.md` §Contracts.
> Last verified: 2026-08-21.

All declaration-only, all marked `❄️ FROZEN — repo owner must approve changes`. depcruise rule
`contracts-imports-nothing` allows contracts→contracts imports only. Change process: stop,
propose diff, wait for owner approval.

| File           | Exports                                                                                                             | Notes                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `events.ts`    | `RawSourceEvent`, `AgentEvent` (17 kinds), `Confidence`, `SourceId`                                                 | Confirmed against real payloads 2026-08-19 (Claude 2.1.235, Codex 0.148). Sanitizing is core's job, not adapters'. `originRef` never persisted verbatim.           |
| `adapter.ts`   | `AdapterCapabilities`, `ConfigChange`, `InstallResult`, `HealthCheck`, `AgentAdapter`                               | Install/health types **not yet confirmed against a real install run**. `AgentAdapter` interface is implemented by nothing — see [gaps-and-debt](gaps-and-debt.md). |
| `world.ts`     | `ActorState` (9, precedence-ordered), `Station` (7), `ActivityCategory`, `StationCell`, `*View` types, `WorldState` | `*View` not yet fixture-confirmed. `stateConfidence` renders in inspector only. Missing `stationCells`/`worldCell` ⇒ renderer seeds locally.                       |
| `receipts.ts`  | `WorkReceipt` (10 kinds), `ReceiptKind`, `ReceiptEvidence`                                                          | `evidence` is mandatory — every receipt cites `source_event`/`exit_code`/`git`/`file_change`. `files` are relative paths only.                                     |
| `attention.ts` | `AttentionItem` (7 types, 4 priorities, 5 statuses)                                                                 | —                                                                                                                                                                  |
| `intents.ts`   | `UserIntent` union (7 kinds)                                                                                        | Only the three `attention_*` kinds have handlers today; `receipt_mark_reviewed`, `report_seen`, `pairing_*` are accepted-and-audited no-ops.                       |
| `stream.ts`    | `WorldPatchOp` (replace by top-level `WorldState` key), `StreamMessage`                                             | Patches are whole-collection replacement, deliberately — "optimize later".                                                                                         |

Two boundary contracts to remember (spec): `AgentEvent` between adapters↔core (new provider =
new mapper, core untouched); `WorldState`+`UserIntent` between core↔web (new renderer = new
client, core untouched). No RPC client — types travel through `#contracts/*` on both sides.
