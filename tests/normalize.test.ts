import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { fromHookPost } from "#adapters/claude/mapper.js";
import { fromRolloutLine } from "#adapters/codex/rollout.js";
import type { AgentEvent } from "#contracts/events.js";
import { normalize, truncateSummary } from "#core/normalize.js";

type CaptureLine = { receivedAt: number; hook: string; body: unknown };

const replayClaudeFixture = (): AgentEvent[] => {
  const file = join(import.meta.dirname, "fixtures", "claude", "hooks-v2.1.235.jsonl");
  const lines = readFileSync(file, "utf8").trim().split("\n");
  const events: AgentEvent[] = [];
  for (const line of lines) {
    const capture = JSON.parse(line) as CaptureLine;
    const event = normalize(fromHookPost(capture.body, capture.receivedAt));
    if (event) events.push(event);
  }
  return events;
};

describe("normalize: claude hook fixture replay", () => {
  const events = replayClaudeFixture();

  it("produces canonical events for every mapped hook", () => {
    const kinds = new Set(events.map((e) => e.kind));
    expect(kinds).toContain("session_started");
    expect(kinds).toContain("session_ended");
    expect(kinds).toContain("prompt_submitted");
    expect(kinds).toContain("activity_started");
    expect(kinds).toContain("activity_completed");
    expect(kinds).toContain("activity_failed");
    expect(kinds).toContain("subagent_started");
    expect(kinds).toContain("subagent_completed");
    expect(kinds).toContain("task_completed");
    expect(kinds).toContain("attention_requested");
  });

  it("attributes subagent tool calls to the subagent actor with a parent", () => {
    const subagentActivity = events.filter((e) => e.parentActorId !== undefined && e.activity !== undefined);
    expect(subagentActivity.length).toBeGreaterThan(0);
    for (const e of subagentActivity) {
      expect(e.actorId).not.toBe(e.sessionId);
      expect(e.parentActorId).toBe(e.sessionId);
    }
  });

  it("keeps task_completed verified (native signal) and everything else at most observed", () => {
    for (const e of events) {
      if (e.kind === "task_completed") expect(e.confidence).toBe("verified");
      else expect(e.confidence).toBe("observed");
    }
  });

  it("maps the approval flow: PermissionRequest carries the tool detail", () => {
    const approvals = events.filter((e) => e.kind === "attention_requested");
    expect(approvals.length).toBeGreaterThan(0);
    expect(approvals.some((e) => e.attention?.summary.includes("Bash"))).toBe(true);
    for (const e of approvals) expect(e.attention?.type).toBe("approval");
  });

  it("carries permissionMode verbatim when present", () => {
    const modes = new Set(events.map((e) => e.permissionMode).filter(Boolean));
    expect(modes).toContain("default");
    expect(modes).toContain("auto");
  });

  it("never persists absolute paths in file fields or summaries", () => {
    for (const e of events) {
      if (e.file) expect(e.file.relativePath.startsWith("/")).toBe(false);
      if (e.summary) expect(e.summary.length).toBeLessThanOrEqual(160);
    }
  });

  it("deduplicates: replaying the same fixture twice yields identical dedupeKeys", () => {
    const again = replayClaudeFixture();
    expect(again.map((e) => e.dedupeKey)).toEqual(events.map((e) => e.dedupeKey));
  });

  it("does not crash on unknown or malformed payloads", () => {
    expect(normalize(fromHookPost({ hook_event_name: "SomeFutureHook" }, 1))).toBeNull();
    expect(normalize(fromHookPost(null, 1))).toBeNull();
    expect(normalize(fromHookPost("garbage", 1))).toBeNull();
  });
});

describe("normalize: Bash exit code from PostToolUse", () => {
  const bashPostToolUse = (toolResponse: unknown): AgentEvent | null =>
    normalize(
      fromHookPost(
        {
          hook_event_name: "PostToolUse",
          session_id: "s1",
          cwd: "/tmp/proj",
          tool_name: "Bash",
          tool_input: { command: "npm test" },
          tool_response: toolResponse,
        },
        1,
      ),
    );

  it("sets exitCode 0 only when tool_response.interrupted is explicitly false", () => {
    expect(bashPostToolUse({ interrupted: false })?.activity?.exitCode).toBe(0);
  });

  it("never assumes success when the run was interrupted (user-cancelled)", () => {
    expect(bashPostToolUse({ interrupted: true })?.activity?.exitCode).toBeUndefined();
  });

  it("leaves exitCode absent when tool_response is missing or unreadable", () => {
    expect(bashPostToolUse(undefined)?.activity?.exitCode).toBeUndefined();
    expect(bashPostToolUse("not an object")?.activity?.exitCode).toBeUndefined();
  });
});

describe("normalize: codex rollout fixture replay", () => {
  const file = join(import.meta.dirname, "fixtures", "codex", "rollout-v0.148.jsonl");
  const lines = readFileSync(file, "utf8").trim().split("\n");
  const events: AgentEvent[] = [];
  for (const line of lines) {
    const raw = fromRolloutLine(line, "rollout-fixture", 1000);
    const event = raw ? normalize(raw) : null;
    if (event) events.push(event);
  }

  it("derives session start and turn lifecycle from the rollout", () => {
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("session_started");
    expect(kinds).toContain("activity_started");
    expect(kinds).toContain("activity_completed");
  });

  it("uses real rollout timestamps for turns, capped at observed confidence", () => {
    const turnStop = events.find((e) => e.activity?.operation === "turn_stop");
    expect(turnStop).toBeDefined();
    expect(turnStop?.occurredAt).toBeGreaterThan(1_700_000_000_000);
    for (const e of events) expect(e.confidence).toBe("observed");
  });

  it("skips malformed lines without throwing", () => {
    expect(fromRolloutLine("not json", "x", 1)).toBeNull();
  });
});

describe("truncateSummary", () => {
  it("truncates to 160 chars and collapses whitespace", () => {
    expect(truncateSummary("a".repeat(200))?.length).toBe(160);
    expect(truncateSummary("a\n\n  b")).toBe("a b");
    expect(truncateSummary(undefined)).toBeUndefined();
  });
});
