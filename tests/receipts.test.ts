import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { fromHookPost } from "#adapters/claude/mapper.js";
import type { AgentEvent } from "#contracts/events.js";
import { normalize } from "#core/normalize.js";
import { deriveReceipts } from "#core/receipts/receipts.js";

type CaptureLine = { receivedAt: number; hook: string; body: unknown };

const replayFixture = (fileName: string): AgentEvent[] => {
  const file = join(import.meta.dirname, "fixtures", "claude", fileName);
  const lines = readFileSync(file, "utf8").trim().split("\n");
  const events: AgentEvent[] = [];
  for (const line of lines) {
    const capture = JSON.parse(line) as CaptureLine;
    const event = normalize(fromHookPost(capture.body, capture.receivedAt));
    if (event) events.push(event);
  }
  return events;
};

describe("deriveReceipts: claude hook fixture replay", () => {
  const events = replayFixture("hooks-v2.1.235.jsonl");
  const receipts = deriveReceipts(events);

  it("derives one verified task_completed from the native TaskCompleted hook", () => {
    const task = receipts.filter((r) => r.kind === "task_completed");
    expect(task).toHaveLength(1);
    expect(task[0].confidence).toBe("verified");
    expect(task[0].evidence).toEqual([
      { type: "source_event", ref: task[0].id.replace("receipt:task_completed:", ""), label: "TaskCompleted hook" },
    ]);
  });

  it("derives verified test_passed and test_failed from the two recognized `npm test` runs", () => {
    const passed = receipts.filter((r) => r.kind === "test_passed");
    const failed = receipts.filter((r) => r.kind === "test_failed");
    expect(passed).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(passed[0].confidence).toBe("verified");
    expect(failed[0].confidence).toBe("verified");
    expect(failed[0].evidence.some((e) => e.type === "exit_code" && e.ref === "1")).toBe(true);
  });

  it("never derives build receipts or failure_recovered: the fixture never reruns a failing command in a turn", () => {
    expect(receipts.filter((r) => r.kind === "build_passed" || r.kind === "build_failed")).toHaveLength(0);
    expect(receipts.filter((r) => r.kind === "failure_recovered")).toHaveLength(0);
  });

  it("derives observed subagent_returned only for witnessed subagents, never for background helpers", () => {
    // The fixture has 3 SubagentStops, but two (a0ad03af, a8175230) are Claude Code's internal
    // helpers: a lone Stop with no SubagentStart and no activity. Only the real, witnessed
    // subagent (a8d8d101, spawned by an Agent call) earns a receipt — a helper receipt would
    // report work the user never dispatched.
    const subagents = receipts.filter((r) => r.kind === "subagent_returned");
    expect(subagents).toHaveLength(1);
    expect(subagents[0]!.actorId.startsWith("a8d8d101")).toBe(true);
    expect(subagents[0]!.confidence).toBe("observed");
  });

  it("derives observed turn_completed for every Stop hook, never labelled shipped", () => {
    const turns = receipts.filter((r) => r.kind === "turn_completed");
    expect(turns).toHaveLength(6);
    for (const r of turns) {
      expect(r.confidence).toBe("observed");
      expect(r.title.toLowerCase()).not.toContain("shipped");
    }
  });

  it("derives review_ready only for the one turn that wrote a file, listing the relative path", () => {
    const ready = receipts.filter((r) => r.kind === "review_ready");
    expect(ready).toHaveLength(1);
    expect(ready[0].files).toEqual(["util.js"]);
    expect(ready[0].confidence).toBe("observed");
  });

  it("never invents a receipt for plain Read/Edit activity or an unrecognized Bash command", () => {
    const readEdit = events.filter((e) => e.activity?.tool === "Read" || e.activity?.tool === "Edit");
    expect(readEdit.length).toBeGreaterThan(0);
    // The fixture runs `git add -A && git commit ...` — not a recognized test/build prefix.
    const gitCommand = events.find((e) => e.activity?.operation?.startsWith("git"));
    expect(gitCommand).toBeDefined();
    expect(receipts.some((r) => r.evidence.some((e) => e.ref.startsWith("git")))).toBe(false);
  });

  it("every receipt carries non-empty evidence", () => {
    for (const r of receipts) expect(r.evidence.length).toBeGreaterThan(0);
  });

  it("dedupes: replaying the same events twice does not duplicate receipts", () => {
    expect(deriveReceipts([...events, ...events])).toHaveLength(receipts.length);
  });

  it("is sorted by occurredAt", () => {
    for (let i = 1; i < receipts.length; i++)
      expect(receipts[i].occurredAt).toBeGreaterThanOrEqual(receipts[i - 1].occurredAt);
  });
});

describe("deriveReceipts: real recovery fixture replay (fail → fix → pass → commit)", () => {
  const events = replayFixture("hooks-v2.1.235-recovery.jsonl");
  const receipts = deriveReceipts(events);

  it("derives one verified test_failed at exit 1, then one verified test_passed", () => {
    const failed = receipts.filter((r) => r.kind === "test_failed");
    const passed = receipts.filter((r) => r.kind === "test_passed");
    expect(failed).toHaveLength(1);
    expect(passed).toHaveLength(1);
    expect(failed[0].confidence).toBe("verified");
    expect(passed[0].confidence).toBe("verified");
    expect(failed[0].evidence.some((e) => e.type === "exit_code" && e.ref === "1")).toBe(true);
  });

  it("derives one verified failure_recovered, since both sides carry exit codes", () => {
    const recovered = receipts.filter((r) => r.kind === "failure_recovered");
    expect(recovered).toHaveLength(1);
    expect(recovered[0].confidence).toBe("verified");
  });

  it("derives one observed turn_completed", () => {
    const turns = receipts.filter((r) => r.kind === "turn_completed");
    expect(turns).toHaveLength(1);
    expect(turns[0].confidence).toBe("observed");
  });

  it("derives one observed review_ready including the edited file", () => {
    const ready = receipts.filter((r) => r.kind === "review_ready");
    expect(ready).toHaveLength(1);
    expect(ready[0].confidence).toBe("observed");
    expect(ready[0].files).toContain("util.js");
  });

  it("never derives commit_created or a build receipt: git commit IO isn't wired yet, and no build command ran", () => {
    expect(receipts.some((r) => r.kind === "commit_created")).toBe(false);
    expect(receipts.filter((r) => r.kind === "build_passed" || r.kind === "build_failed")).toHaveLength(0);
  });
});

describe("deriveReceipts: failure_recovered", () => {
  // The real fixture never reruns a failing command in the same turn, so this exercises
  // the recovery path directly against the frozen AgentEvent contract (no raw payload guessed).
  const bashEvent = (
    dedupeKey: string,
    occurredAt: number,
    exitCode: number,
    kind: "activity_completed" | "activity_failed",
  ): AgentEvent => ({
    id: dedupeKey,
    dedupeKey,
    occurredAt,
    observedAt: occurredAt,
    source: "claude",
    confidence: "observed",
    projectId: "proj",
    sessionId: "session-1",
    actorId: "session-1",
    turnId: "turn-1",
    kind,
    activity: { category: "terminal", tool: "Bash", operation: "npm test", exitCode },
  });

  it("emits a verified failure_recovered when the same category fails then passes in one turn", () => {
    const events: AgentEvent[] = [
      bashEvent("fail-1", 1, 1, "activity_failed"),
      bashEvent("pass-1", 2, 0, "activity_completed"),
    ];
    const receipts = deriveReceipts(events);
    const recovered = receipts.filter((r) => r.kind === "failure_recovered");
    expect(recovered).toHaveLength(1);
    expect(recovered[0].confidence).toBe("verified");
    expect(recovered[0].occurredAt).toBe(2);
  });

  it("does not recover across different turns", () => {
    const failing = bashEvent("fail-2", 1, 1, "activity_failed");
    const passing = { ...bashEvent("pass-2", 2, 0, "activity_completed"), turnId: "turn-2" };
    const receipts = deriveReceipts([failing, passing]);
    expect(receipts.filter((r) => r.kind === "failure_recovered")).toHaveLength(0);
  });

  it("does not classify a command that merely starts with the prefix text: 'npm test-fixtures/x' is not 'npm test'", () => {
    const notTest: AgentEvent = {
      ...bashEvent("not-test", 1, 0, "activity_completed"),
      activity: { category: "terminal", tool: "Bash", operation: "npm test-fixtures/regen.js", exitCode: 0 },
    };
    expect(deriveReceipts([notTest])).toHaveLength(0);
  });
});
