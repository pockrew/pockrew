// ❄️ FROZEN — repo owner must approve changes. Stop and propose a diff instead of editing.
// RawSourceEvent is not yet confirmed against real captured payloads.

/** Raw payload as an adapter read it. Redact, sanitize and dedupe are core's job, not the adapter's. */
export type RawSourceEvent = {
  source: "claude" | "codex";
  sourceVersion?: string;
  /** Which data path carried this event. */
  channel: "hook" | "jsonl" | "process" | "fs";
  /** Hook name when channel is "hook", e.g. PreToolUse. */
  hook?: string;
  receivedAt: number;
  /** Origin file for debug tracing; never persisted verbatim in the production store. */
  originRef?: string;
  payload: unknown;
};

export type AgentEvent = {
  id: string;
  dedupeKey: string;
  occurredAt: number;
  observedAt: number;

  source: "claude" | "codex";
  sourceVersion?: string;
  confidence: "verified" | "observed" | "inferred";

  projectId: string;
  sessionId: string;
  actorId: string;
  parentActorId?: string;
  turnId?: string;

  kind:
    | "session_started"
    | "session_ended"
    | "prompt_submitted"
    | "model_started"
    | "activity_started"
    | "activity_completed"
    | "activity_failed"
    | "subagent_started"
    | "subagent_completed"
    | "attention_requested"
    | "attention_resolved"
    | "task_completed"
    | "file_touched"
    | "process_alive"
    | "coverage_lost"
    | "coverage_restored";

  activity?: {
    category: "research" | "code" | "terminal" | "review" | "coordination";
    tool?: string;
    operation?: string;
    exitCode?: number;
  };

  attention?: {
    type: "approval" | "question" | "error";
    requestId?: string;
    summary: string;
    expiresAt?: number;
  };

  file?: {
    relativePath: string;
    operation: "read" | "write" | "delete" | "unknown";
  };
  summary?: string;
  rawRef?: string;
};

/** Shared by events, receipts and attention. */
export type Confidence = AgentEvent["confidence"];
export type SourceId = AgentEvent["source"];
