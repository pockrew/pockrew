import type { AgentEvent, RawSourceEvent } from "#contracts/events.js";

/**
 * RawSourceEvent → canonical AgentEvent. Pure function: no IO, no clock reads —
 * hooks carry no timestamp (M0 finding), so occurredAt = raw.receivedAt.
 * Returns null for payloads that map to nothing; never throws on malformed input.
 */
export const normalize = (raw: RawSourceEvent): AgentEvent | null => {
  try {
    if (raw.source === "claude" && raw.channel === "hook") return normalizeClaudeHook(raw);
    if (raw.source === "codex" && raw.channel === "jsonl") return normalizeCodexLine(raw);
    return null;
  } catch {
    return null;
  }
};

type ClaudePayload = {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  permission_mode?: string;
  prompt_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_use_id?: string;
  /** Only field we trust off tool_response: whether the call actually ran to completion. */
  tool_response?: { interrupted?: boolean };
  agent_id?: string;
  agent_type?: string;
  error?: string;
  task_id?: string;
  task_subject?: string;
  last_assistant_message?: string;
  message?: string;
  notification_type?: string;
  reason?: string;
};

type Activity = NonNullable<AgentEvent["activity"]>;

const TOOL_CATEGORY: Record<string, Activity["category"]> = {
  Read: "research",
  Glob: "research",
  Grep: "research",
  WebSearch: "research",
  WebFetch: "research",
  Edit: "code",
  Write: "code",
  NotebookEdit: "code",
  Bash: "terminal",
  Task: "coordination",
  Agent: "coordination",
};

const activityFor = (tool: string | undefined): Activity => {
  // Unknown tool maps to terminal and never crashes (spec: event rules).
  if (!tool) return { category: "terminal" };
  return { category: TOOL_CATEGORY[tool] ?? "terminal", tool };
};

const commandFor = (p: ClaudePayload): string | undefined => {
  const command = (p.tool_input ?? {})["command"];
  return typeof command === "string" ? command : undefined;
};

/** Parses the leading "Exit code N" that PostToolUseFailure prepends to `error`; absent when unparseable. */
const exitCodeFromError = (error: string | undefined): number | undefined => {
  const match = error?.match(/^Exit code (\d+)/);
  return match ? Number(match[1]) : undefined;
};

/**
 * PostToolUse fires whether the run finished or was cancelled — a user-interrupted Bash call
 * carries no exit code, and inventing 0 would fake a pass. Only `interrupted === false` verifies
 * completion; a missing or unreadable tool_response leaves exitCode absent (never assume success).
 */
const exitCodeFromResponse = (p: ClaudePayload): number | undefined => {
  return p.tool_response?.interrupted === false ? 0 : undefined;
};

const bashActivity = (p: ClaudePayload, exitCode: number | undefined): Activity => ({
  ...activityFor(p.tool_name),
  ...opt("operation", truncateSummary(commandFor(p))),
  ...opt("exitCode", exitCode),
});

const fileFor = (p: ClaudePayload): AgentEvent["file"] | undefined => {
  const input = p.tool_input ?? {};
  const filePath = typeof input["file_path"] === "string" ? input["file_path"] : undefined;
  if (!filePath) return undefined;
  const op = p.tool_name === "Read" ? "read" : p.tool_name === "Edit" || p.tool_name === "Write" ? "write" : "unknown";
  return { relativePath: relativize(filePath, p.cwd), operation: op };
};

const relativize = (path: string, cwd: string | undefined): string => {
  if (cwd && path.startsWith(cwd + "/")) return path.slice(cwd.length + 1);
  if (cwd && path === cwd) return ".";
  // Never persist an absolute path in user-visible event fields; keep last segments.
  return path.startsWith("/") ? path.split("/").slice(-2).join("/") : path;
};

export const truncateSummary = (text: string | undefined): string | undefined => {
  if (!text) return undefined;
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 160 ? clean.slice(0, 159) + "…" : clean;
};

/** Spread helper: include an optional property only when it has a value. */
const opt = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } => {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
};

const base = (raw: RawSourceEvent, p: ClaudePayload, kindKey: string) => {
  const sessionId = p.session_id ?? "unknown-session";
  const actorId = p.agent_id ?? sessionId;
  const dedupeKey = `claude:${kindKey}:${sessionId}:${p.tool_use_id ?? p.prompt_id ?? raw.receivedAt}`;
  return {
    id: dedupeKey,
    dedupeKey,
    occurredAt: raw.receivedAt,
    observedAt: raw.receivedAt,
    source: "claude" as const,
    confidence: "observed" as const,
    projectId: p.cwd ?? "unknown-project",
    sessionId,
    actorId,
    ...opt("sourceVersion", raw.sourceVersion),
    ...opt("parentActorId", p.agent_id ? sessionId : undefined),
    ...opt("turnId", p.prompt_id),
    ...opt("permissionMode", p.permission_mode),
  };
};

const normalizeClaudeHook = (raw: RawSourceEvent): AgentEvent | null => {
  const p = raw.payload as ClaudePayload;
  const hook = raw.hook ?? p.hook_event_name;
  switch (hook) {
    case "SessionStart":
      return { ...base(raw, p, "session_started"), kind: "session_started" };
    case "SessionEnd":
      return { ...base(raw, p, "session_ended"), kind: "session_ended", ...opt("summary", truncateSummary(p.reason)) };
    case "UserPromptSubmit":
      return { ...base(raw, p, "prompt_submitted"), kind: "prompt_submitted" };
    case "PreToolUse":
      return {
        ...base(raw, p, "activity_started"),
        kind: "activity_started",
        activity: activityFor(p.tool_name),
        ...opt("file", fileFor(p)),
      };
    case "PostToolUse": {
      const approvedBy = approvedByFor(p.permission_mode);
      const activity = p.tool_name === "Bash" ? bashActivity(p, exitCodeFromResponse(p)) : activityFor(p.tool_name);
      return {
        ...base(raw, p, "activity_completed"),
        kind: "activity_completed",
        activity: { ...activity, ...opt("approvedBy", approvedBy) },
        ...opt("file", fileFor(p)),
      };
    }
    case "PostToolUseFailure":
      return {
        ...base(raw, p, "activity_failed"),
        kind: "activity_failed",
        activity: p.tool_name === "Bash" ? bashActivity(p, exitCodeFromError(p.error)) : activityFor(p.tool_name),
        ...opt("summary", truncateSummary(p.error)),
      };
    case "SubagentStart":
      return { ...base(raw, p, "subagent_started"), kind: "subagent_started" };
    case "SubagentStop":
      return {
        ...base(raw, p, "subagent_completed"),
        kind: "subagent_completed",
        ...opt("summary", truncateSummary(p.last_assistant_message)),
      };
    case "Stop":
      // Turn stop. No dedicated kind in the frozen contract; receipts derive the
      // observed turn receipt from operation === "turn_stop" (spec derivation rule 3).
      return {
        ...base(raw, p, "turn_stop"),
        kind: "activity_completed",
        activity: { category: "coordination", operation: "turn_stop" },
        ...opt("summary", truncateSummary(p.last_assistant_message)),
      };
    case "TaskCompleted":
      return {
        ...base(raw, p, `task_completed:${p.task_id ?? ""}`),
        kind: "task_completed",
        confidence: "verified",
        ...opt("summary", truncateSummary(p.task_subject)),
      };
    case "PermissionRequest":
      return {
        ...base(raw, p, "attention_approval"),
        kind: "attention_requested",
        attention: {
          type: "approval",
          requestId: `${p.session_id}:${p.prompt_id}:${p.tool_name}`,
          summary: truncateSummary(`${p.tool_name}: ${JSON.stringify(p.tool_input ?? {})}`) ?? "approval requested",
        },
      };
    case "Notification":
      // permission_prompt duplicates PermissionRequest → same dedupeKey family, but
      // PermissionRequest carries the tool detail, so Notification is only a fallback.
      if (p.notification_type !== "permission_prompt") return null;
      return {
        ...base(raw, p, "attention_approval"),
        kind: "attention_requested",
        attention: { type: "approval", summary: truncateSummary(p.message) ?? "approval requested" },
      };
    default:
      return null; // PreCompact and unknown hooks map to nothing rather than guessing.
  }
};

const approvedByFor = (mode: string | undefined): "human" | "auto" | "policy" | "unknown" | undefined => {
  // Cross-event "human" derivation (PermissionRequest matched) lands with the reducer in M2.
  if (mode === "bypassPermissions" || mode === "dontAsk") return "policy";
  if (mode === "auto") return "auto";
  if (mode === "default") return "unknown";
  return undefined;
};

type CodexLine = {
  type?: string;
  timestamp?: string;
  payload?: {
    type?: string;
    id?: string;
    session_id?: string;
    cwd?: string;
    cli_version?: string;
    turn_id?: string;
    started_at?: number;
    completed_at?: number;
    last_agent_message?: string;
    name?: string;
  };
};

const normalizeCodexLine = (raw: RawSourceEvent): AgentEvent | null => {
  const line = raw.payload as CodexLine;
  const p = line.payload ?? {};
  const sessionId = p.session_id ?? p.id ?? raw.originRef ?? "unknown-session";
  const common = {
    observedAt: raw.receivedAt,
    source: "codex" as const,
    confidence: "observed" as const,
    projectId: p.cwd ?? "unknown-project",
    sessionId,
    actorId: sessionId,
    ...opt("sourceVersion", p.cli_version ?? raw.sourceVersion),
  };
  if (line.type === "session_meta") {
    const dedupeKey = `codex:session_started:${sessionId}`;
    return { ...common, id: dedupeKey, dedupeKey, occurredAt: raw.receivedAt, kind: "session_started" };
  }
  if (line.type === "event_msg" && p.type === "task_started") {
    const dedupeKey = `codex:turn_started:${p.turn_id}:${sessionId}`;
    return {
      ...common,
      id: dedupeKey,
      dedupeKey,
      occurredAt: p.started_at ? p.started_at * 1000 : raw.receivedAt,
      kind: "activity_started",
      activity: { category: "coordination", operation: "turn_start" },
      ...opt("turnId", p.turn_id),
    };
  }
  if (line.type === "event_msg" && p.type === "task_complete") {
    const dedupeKey = `codex:turn_stop:${p.turn_id}:${sessionId}`;
    return {
      ...common,
      id: dedupeKey,
      dedupeKey,
      occurredAt: p.completed_at ? p.completed_at * 1000 : raw.receivedAt,
      kind: "activity_completed",
      activity: { category: "coordination", operation: "turn_stop" },
      ...opt("turnId", p.turn_id),
      ...opt("summary", truncateSummary(p.last_agent_message)),
    };
  }
  if (line.type === "response_item" && p.type === "custom_tool_call") {
    const dedupeKey = `codex:tool:${raw.receivedAt}:${sessionId}`;
    return {
      ...common,
      id: dedupeKey,
      dedupeKey,
      occurredAt: raw.receivedAt,
      kind: "activity_started",
      activity: { category: "terminal", ...opt("tool", p.name) },
    };
  }
  return null;
};
