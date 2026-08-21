import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { fromHookPost } from "#adapters/claude/mapper.js";
import type { AttentionItem } from "#contracts/attention.js";
import type { AgentEvent } from "#contracts/events.js";
import { deriveAttention } from "#core/attention/attention.js";
import { normalize } from "#core/normalize.js";
import { deriveReceipts } from "#core/receipts/receipts.js";
import { buildShiftReport, NO_VERIFIED_OUTCOME } from "#core/reports/reports.js";

let seq = 0;
const ev = (over: Partial<AgentEvent> & { kind: AgentEvent["kind"]; occurredAt: number }): AgentEvent => {
  seq += 1;
  return {
    id: `e${seq}`,
    dedupeKey: `e${seq}`,
    observedAt: over.occurredAt,
    source: "claude",
    confidence: "observed",
    projectId: "/proj",
    sessionId: "s1",
    actorId: "a1",
    ...over,
  };
};

const taskDone = (occurredAt: number): AgentEvent =>
  ev({ kind: "task_completed", occurredAt, confidence: "verified", summary: "shipped the thing" });

const attn = (type: AttentionItem["type"], openedAt: number, over: Partial<AttentionItem> = {}): AttentionItem => ({
  id: `attn:${type}:${openedAt}`,
  type,
  priority: "high",
  confidence: "observed",
  status: "open",
  actorIds: ["a1"],
  projectId: "/proj",
  summary: `${type} summary`,
  openedAt,
  updatedAt: openedAt,
  ...over,
});

const report = (events: AgentEvent[], attention: AttentionItem[], from: number, to: number) =>
  buildShiftReport({ events, receipts: deriveReceipts(events), attention, from, to });

describe("shift report: window and confidence split", () => {
  it("a receipt AT `from` is excluded, AT `to` is included; earlier writes never leak into changed", () => {
    const events = [
      taskDone(1_000),
      taskDone(5_000),
      ev({
        kind: "activity_completed",
        occurredAt: 500,
        file: { relativePath: "old.ts", operation: "write" },
      }),
    ];
    const r = report(events, [], 1_000, 5_000);
    expect(r.shipped).toHaveLength(1);
    expect(r.shipped[0]!.occurredAt).toBe(5_000);
    expect(r.changed).toHaveLength(0);
  });

  it("verified receipts land in shipped, observed in completedActivity, never both", () => {
    const events = [
      taskDone(2_000),
      ev({ kind: "subagent_completed", occurredAt: 3_000, actorId: "sub1", summary: "scouted" }),
    ];
    const r = report(events, [], 0, 10_000);
    expect(r.shipped.every((x) => x.confidence === "verified")).toBe(true);
    expect(r.completedActivity.every((x) => x.confidence !== "verified")).toBe(true);
    const ids = new Set(r.shipped.map((x) => x.id));
    expect(r.completedActivity.some((x) => ids.has(x.id))).toBe(false);
    expect(r.noVerifiedOutcome).toBeUndefined();
  });
});

describe("shift report: the no-verified-outcome sentence", () => {
  it("is the exact spec sentence when agents were active with nothing verified", () => {
    const r = report([ev({ kind: "prompt_submitted", occurredAt: 2_000 })], [], 1_000, 3_000);
    expect(r.noVerifiedOutcome).toBe(NO_VERIFIED_OUTCOME);
    expect(NO_VERIFIED_OUTCOME).toBe("Agents were active, but no verified outcome was captured.");
  });

  it("is absent when nothing at all happened, and when something verified shipped", () => {
    expect(report([], [], 0, 1_000).noVerifiedOutcome).toBeUndefined();
    const onlyDaemon = [ev({ kind: "coverage_lost", occurredAt: 500, actorId: "daemon" })];
    expect(report(onlyDaemon, [], 0, 1_000).noVerifiedOutcome).toBeUndefined();
    expect(report([taskDone(500)], [], 0, 1_000).noVerifiedOutcome).toBeUndefined();
  });
});

describe("shift report: next actions", () => {
  it("orders by type approval > conflict > error > ready_review > coverage regardless of input order", () => {
    const items = [
      attn("coverage_gap", 1_000, { priority: "info" }),
      attn("error", 2_000),
      attn("approval", 3_000),
      attn("conflict", 4_000),
      attn("ready_review", 5_000, { priority: "normal" }),
    ];
    const r = report([], items, 0, 10_000);
    expect(r.nextActions).toEqual([
      "Approve or deny: approval summary",
      "Check overlap: conflict summary",
      "Unblock: error summary",
      "Review: ready_review summary",
      "Restore coverage: coverage_gap summary",
    ]);
  });

  it("needsYouNow keeps only open/acknowledged approvals/questions/errors/conflicts — coverage stays in §5, but still reaches nextActions", () => {
    const items = [
      attn("error", 1_000, { status: "resolved" }),
      attn("coverage_gap", 2_000, { priority: "info" }),
      attn("approval", 3_000, { status: "acknowledged" }),
    ];
    const r = report([], items, 0, 10_000);
    expect(r.needsYouNow.map((it) => it.type)).toEqual(["approval"]);
    expect(r.nextActions).toEqual(["Approve or deny: approval summary", "Restore coverage: coverage_gap summary"]);
  });
});

describe("shift report: changed and blind windows", () => {
  it("groups written files by project, deduped and sorted; a started-but-never-completed write changed nothing", () => {
    const w = (occurredAt: number, projectId: string, relativePath: string): AgentEvent =>
      ev({ kind: "activity_completed", occurredAt, projectId, file: { relativePath, operation: "write" } });
    const startedOnly = ev({
      kind: "activity_started",
      occurredAt: 5_000,
      projectId: "/a",
      file: { relativePath: "denied.ts", operation: "write" },
    });
    const r = report(
      [w(1_000, "/a", "z.ts"), w(2_000, "/a", "a.ts"), w(3_000, "/a", "z.ts"), w(4_000, "/b", "b.ts"), startedOnly],
      [],
      0,
      10_000,
    );
    expect(r.changed).toEqual([
      { projectId: "/a", files: ["a.ts", "z.ts"] },
      { projectId: "/b", files: ["b.ts"] },
    ]);
  });

  it("pairs coverage_lost/restored; an unclosed loss runs to the window edge", () => {
    const events = [
      ev({ kind: "coverage_lost", occurredAt: 1_000, actorId: "daemon" }),
      ev({ kind: "coverage_restored", occurredAt: 2_000, actorId: "daemon" }),
      ev({ kind: "coverage_lost", occurredAt: 5_000, actorId: "daemon" }),
    ];
    const r = report(events, [], 0, 9_000);
    expect(r.problems.blindWindows).toEqual([
      { from: 1_000, to: 2_000 },
      { from: 5_000, to: 9_000 },
    ]);
  });

  it("test/build failures and recoveries land in problems", () => {
    const bash = (occurredAt: number, exitCode: number): AgentEvent =>
      ev({
        kind: "activity_completed",
        occurredAt,
        activity: { category: "terminal", tool: "Bash", operation: "npm test", exitCode },
      });
    const r = report([bash(1_000, 1), bash(2_000, 0)], [], 0, 10_000);
    expect(r.problems.failures.map((x) => x.kind)).toEqual(["test_failed"]);
    expect(r.problems.recoveries.map((x) => x.kind)).toEqual(["failure_recovered"]);
  });

  it("tool failures that never become a receipt still land in problems.errors", () => {
    const failed = ev({
      kind: "activity_failed",
      occurredAt: 1_500,
      activity: { category: "code", tool: "Edit" },
      summary: "Exit code 1",
    });
    const r = report([failed], [], 0, 10_000);
    expect(r.problems.failures).toHaveLength(0);
    expect(r.problems.errors).toEqual([
      { actorId: "a1", projectId: "/proj", occurredAt: 1_500, summary: "Exit code 1" },
    ]);
  });
});

describe("shift report: real fixture replay", () => {
  it("is deterministic and honest over the real session", () => {
    const lines = readFileSync(join(import.meta.dirname, "fixtures", "claude", "hooks-v2.1.235.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { receivedAt: number; body: unknown });
    const events = lines
      .map((line) => normalize(fromHookPost(line.body, line.receivedAt)))
      .filter((e): e is AgentEvent => e !== null);
    const to = events[events.length - 1]!.occurredAt;
    const build = () =>
      buildShiftReport({
        events,
        receipts: deriveReceipts(events),
        attention: deriveAttention(events, to),
        from: 0,
        to,
      });
    const r = build();
    expect(r).toEqual(build()); // same inputs, same report — no clock reads, no randomness
    expect(r.shipped.every((x) => x.confidence === "verified")).toBe(true);
    expect(r.changed.every((p) => p.files.every((f) => !f.startsWith("/")))).toBe(true);
  });
});
