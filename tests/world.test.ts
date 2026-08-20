import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { fromHookPost } from "#adapters/claude/mapper.js";
import type { AgentEvent } from "#contracts/events.js";
import type { WorldState } from "#contracts/world.js";
import { normalize } from "#core/normalize.js";
import { deriveReceipts } from "#core/receipts/receipts.js";
import { defaultTimers } from "#core/reduce/reduce.js";
import { assembleWorld } from "#core/world.js";

type CaptureLine = { receivedAt: number; hook: string; body: unknown };

const replay = (fixture: string): AgentEvent[] => {
  const file = join(import.meta.dirname, "fixtures", "claude", fixture);
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .flatMap((line) => {
      const capture = JSON.parse(line) as CaptureLine;
      const event = normalize(fromHookPost(capture.body, capture.receivedAt));
      return event ? [event] : [];
    });
};

/** Coverage is the server's to compute from real signals; assembleWorld only carries it. */
const coverage: WorldState["coverage"] = [
  { source: "claude", status: "healthy" },
  { source: "codex", status: "offline", message: "no codex tailer running" },
];

describe("assembleWorld: claude hook fixture replay", () => {
  const events = replay("hooks-v2.1.235.jsonl");
  const lastOccurredAt = Math.max(...events.map((e) => e.occurredAt));
  const now = lastOccurredAt + defaultTimers.endedHoldMs + 60_000;
  const world = assembleWorld(events, now, coverage);

  it("carries the coverage it was given, never an invented one", () => {
    expect(world.coverage).toEqual(coverage);
    expect(world.generatedAt).toBe(now);
  });

  it("groups actors into districts named after the project directory", () => {
    expect(world.projects.map((p) => p.displayName)).toEqual(["m0-perm", "m0-project"]);
    for (const p of world.projects) {
      expect(p.actorIds.length).toBeGreaterThan(0);
      for (const id of p.actorIds) {
        expect(world.actors.find((a) => a.id === id)?.projectId).toBe(p.id);
      }
    }
  });

  it("ends every session actor whose SessionEnd was observed, and parks it in the lounge", () => {
    const sessions = world.actors.filter((a) => a.id === a.sessionId && a.state === "ended");
    expect(sessions.length).toBeGreaterThan(0);
    for (const a of sessions) expect(a.station).toBe("lounge");
  });

  it("sits the actor with the unresolved approval at the boss desk", () => {
    const waiting = world.actors.filter((a) => a.state === "waiting_user");
    expect(waiting).toHaveLength(1);
    const actor = waiting[0]!;
    expect(actor.station).toBe("boss_desk");
    expect(world.attention).toHaveLength(1);
    const item = world.attention[0]!;
    expect(item).toMatchObject({ type: "approval", priority: "high", status: "open", projectId: actor.projectId });
    expect(item.sourceRequestId).toContain("Bash"); // real PermissionRequest id, not invented
    expect(actor.attentionIds).toEqual([item.id]);
    expect(world.projects.find((p) => p.id === actor.projectId)?.openAttentionCount).toBe(1);
  });

  it("parks an actor with no activity signal in the lounge with no current activity", () => {
    // Session 317d6ca1 is SessionStart + SessionEnd only — no tool call ever ran.
    const bare = world.actors.find((a) => a.id.startsWith("317d6ca1"));
    expect(bare?.station).toBe("lounge");
    expect(bare?.currentActivityId).toBeUndefined();
  });

  it("counts only verified receipts per district, and truncated summaries stay truncated", () => {
    const receipts = deriveReceipts(events);
    for (const p of world.projects) {
      const verified = receipts.filter((r) => r.projectId === p.id && r.confidence === "verified");
      expect(p.verifiedReceiptCount).toBe(verified.length);
    }
    expect(world.recentReceipts.some((r) => r.confidence === "observed")).toBe(true);
    for (const r of world.recentReceipts) {
      expect(r.summary === undefined || r.summary.length <= 160).toBe(true);
      expect(r.reviewed).toBe(false); // no user signal for "reviewed" exists yet
    }
    const review = world.recentReceipts.find((r) => r.kind === "review_ready");
    expect(review?.fileCount).toBeGreaterThan(0);
  });

  it("milestones count verified receipts only, at targets 1/10/50/200 plus the recovery badge", () => {
    const verified = deriveReceipts(events).filter((r) => r.confidence === "verified");
    const district = world.projects.find((p) => p.displayName === "m0-project")!;
    const own = world.milestones.filter((m) => m.projectId === district.id);
    const verifiedHere = verified.filter((r) => r.projectId === district.id);

    expect(own.map((m) => [m.key, m.target])).toEqual([
      ["first_delivery", 1],
      ["workshop_1", 10],
      ["workshop_2", 50],
      ["district_landmark", 200],
      ["recovery_badge", 10],
    ]);
    // Observed receipts (turn stops, subagent returns) never move a milestone, and neither does a
    // verified *failure* — test_failed carries a real exit code but is not a delivery.
    const outcomes = verifiedHere.filter((r) => r.kind !== "test_failed" && r.kind !== "build_failed");
    expect(verifiedHere.length).toBeGreaterThan(outcomes.length); // the fixture has a failing test
    expect(verifiedHere.length).toBeLessThan(deriveReceipts(events).filter((r) => r.projectId === district.id).length);
    for (const m of own.filter((x) => x.key !== "recovery_badge")) expect(m.current).toBe(outcomes.length);
    expect(own.find((m) => m.key === "first_delivery")?.achievedAt).toBe(outcomes[0]!.occurredAt);
    expect(own.find((m) => m.key === "workshop_1")?.achievedAt).toBeUndefined();
    expect(own.find((m) => m.key === "recovery_badge")?.current).toBe(0); // no recovery in this fixture
  });

  it("is deterministic — the same events and clock assemble byte-identical state", () => {
    expect(JSON.stringify(assembleWorld(events, now, coverage))).toBe(JSON.stringify(world));
    // Duplicated events (a re-POSTed hook) change nothing either.
    expect(JSON.stringify(assembleWorld([...events, ...events], now, coverage))).toBe(JSON.stringify(world));
  });
});

describe("assembleWorld: actor display names come from real prompts, never invented", () => {
  const events = replay("hooks-v2.1.235.jsonl");
  const now = Math.max(...events.map((e) => e.occurredAt)) + defaultTimers.endedHoldMs + 60_000;
  const world = assembleWorld(events, now, coverage);

  it("names a main actor from its session's own first user prompt, truncated for display", () => {
    const actor = world.actors.find((a) => a.id === "45da5987-ae39-4fe3-b566-be9be9e798c0")!;
    expect(actor.displayName.startsWith("Do these steps in order")).toBe(true);
    expect(actor.displayName.length).toBeLessThanOrEqual(48);
    expect(actor.displayName.endsWith("…")).toBe(true); // the real prompt runs well past 48 chars
  });

  it("names a subagent from the real description its Task/Agent spawn call carried", () => {
    // Fixture: session 45da5987 sends the Task tool a description "Read test.js and summarize
    // in one line" — the only usable text for that subagent (SubagentStart itself carries none).
    const subagent = world.actors.find((a) => a.id.startsWith("a8d8d101"))!;
    expect(subagent.displayName).toBe("Read test.js and summarize in one line");
  });

  it("falls back to a structural label, per-parent ordinal, when no spawn description exists", () => {
    // Fixture: session 04965c90 has two SubagentStop events (a0ad03af, a8175230) with no
    // SubagentStart and no Task/Agent tool call ever recorded — no usable text for either.
    const first = world.actors.find((a) => a.id.startsWith("a0ad03af"))!;
    const second = world.actors.find((a) => a.id.startsWith("a8175230"))!;
    expect(first.displayName.startsWith("Subagent 1 · ")).toBe(true);
    expect(second.displayName.startsWith("Subagent 2 · ")).toBe(true);
    // The composed label is what's budget-capped, not just the parent fragment inside it.
    expect(first.displayName.length).toBeLessThanOrEqual(48);
    expect(second.displayName.length).toBeLessThanOrEqual(48);
  });

  it("falls back to the bare source+id form when a session has no prompt at all", () => {
    // Session 317d6ca1 is SessionStart + SessionEnd only — no UserPromptSubmit ever captured.
    const bare = world.actors.find((a) => a.id.startsWith("317d6ca1"))!;
    expect(bare.displayName).toBe("Claude 317d6ca1");
  });

  it("is deterministic: re-assembling the same events yields byte-identical names", () => {
    const again = assembleWorld(events, now, coverage);
    expect(again.actors.map((a) => a.displayName)).toEqual(world.actors.map((a) => a.displayName));
    // Duplicated events (a re-POSTed hook) change nothing either.
    const withDupes = assembleWorld([...events, ...events], now, coverage);
    expect(withDupes.actors.map((a) => a.displayName)).toEqual(world.actors.map((a) => a.displayName));
  });
});

describe("assembleWorld: subagent naming never guesses across an ambiguous spawn window", () => {
  const build = (
    actorId: string,
    kind: AgentEvent["kind"],
    occurredAt: number,
    rest: Partial<AgentEvent> = {},
  ): AgentEvent => ({
    id: `${actorId}:${kind}:${occurredAt}`,
    dedupeKey: `${actorId}:${kind}:${occurredAt}`,
    occurredAt,
    observedAt: occurredAt,
    source: "claude",
    confidence: "observed",
    projectId: "/tmp/proj",
    sessionId: "parent-1",
    actorId,
    kind,
    ...rest,
  });

  // A real "parallel dispatch" shape: two Task calls both fire before either subagent's own
  // SubagentStart lands, so PreToolUse order and SubagentStart order carry no guarantee of matching.
  const events: AgentEvent[] = [
    build("parent-1", "prompt_submitted", 1_000, { summary: "investigate two flaky tests in parallel" }),
    build("parent-1", "activity_started", 1_100, {
      activity: { category: "coordination", tool: "Task", operation: "Fix bug A" },
    }),
    build("parent-1", "activity_started", 1_200, {
      activity: { category: "coordination", tool: "Agent", operation: "Fix bug B" },
    }),
    build("sub-1", "subagent_started", 1_300, { parentActorId: "parent-1", summary: "general-purpose" }),
    build("sub-2", "subagent_started", 1_400, { parentActorId: "parent-1", summary: "reviewer" }),
  ];
  const world = assembleWorld(events, 5_000, coverage);

  it("never attributes either Task description to a subagent when the pairing is ambiguous", () => {
    const first = world.actors.find((a) => a.id === "sub-1")!;
    const second = world.actors.find((a) => a.id === "sub-2")!;
    // Two Task calls, two subagents, no id says which is which — neither guess is safe.
    expect(first.displayName).not.toContain("Fix bug");
    expect(second.displayName).not.toContain("Fix bug");
  });

  it("uses the real agent_type in the structural fallback instead of a bare 'Subagent N'", () => {
    const first = world.actors.find((a) => a.id === "sub-1")!;
    const second = world.actors.find((a) => a.id === "sub-2")!;
    expect(first.displayName.startsWith("general-purpose #1 · ")).toBe(true);
    expect(second.displayName.startsWith("reviewer #2 · ")).toBe(true);
  });
});

describe("assembleWorld: activity category maps to a station", () => {
  const events = replay("hooks-v2.1.235.jsonl");
  const actorId = "45da5987-ae39-4fe3-b566-be9be9e798c0";

  // Each timestamp sits a few ms after that tool's PreToolUse in the real capture.
  const cases: Array<[number, string, WorldState["actors"][number]["station"]]> = [
    [1787146923760, "Read", "library"],
    [1787146926945, "Edit", "workshop"],
    [1787146929530, "Bash", "lab"],
    [1787146934480, "Agent", "hq"],
  ];

  for (const [at, tool, station] of cases) {
    it(`puts a running ${tool} call in the ${station}`, () => {
      const world = assembleWorld(
        events.filter((e) => e.occurredAt <= at),
        at,
        coverage,
      );
      const actor = world.actors.find((a) => a.id === actorId)!;
      expect(actor.state).toBe("working");
      expect(actor.station).toBe(station);
      const activity = world.activities.find((a) => a.id === actor.currentActivityId)!;
      expect(activity).toMatchObject({ tool, status: "running", actorId });
    });
  }
});

describe("assembleWorld: an activity past its window is unknown, never done", () => {
  const events = replay("hooks-v2.1.235.jsonl");
  const startedAt = 1787146929521; // PreToolUse Bash `npm test`, whose PostToolUse we cut off
  const prefix = events.filter((e) => e.occurredAt <= startedAt);

  it("keeps a fresh open call running", () => {
    const world = assembleWorld(prefix, startedAt + defaultTimers.activityWindowMs, coverage);
    expect(world.activities.at(-1)?.status).toBe("running");
  });

  it("downgrades it to unknown once the reducer's activity window has passed", () => {
    const world = assembleWorld(prefix, startedAt + defaultTimers.activityWindowMs + 1, coverage);
    const activity = world.activities.find((a) => a.tool === "Bash")!;
    expect(activity.status).toBe("unknown");
    expect(activity.confidence).toBe("inferred");
    expect(activity.endedAt).toBeUndefined(); // no completion was ever observed
    // The reducer reaches the same verdict, so the pair never disagrees.
    const actor = world.actors.find((a) => a.id === activity.actorId)!;
    expect(actor.state).toBe("unknown");
    expect(actor.station).toBe("lounge");
  });
});

describe("assembleWorld: one provider request is one attention item", () => {
  const approval = (
    actorId: string,
    occurredAt: number,
    requestId: string | undefined,
    summary: string,
    kind: AgentEvent["kind"] = "attention_requested",
  ): AgentEvent => ({
    id: `${actorId}:${kind}:${occurredAt}`,
    dedupeKey: `${actorId}:${kind}:${occurredAt}`,
    occurredAt,
    observedAt: occurredAt,
    source: "claude",
    confidence: "observed",
    projectId: "/tmp/proj",
    sessionId: actorId,
    actorId,
    kind,
    attention: { type: "approval", summary, ...(requestId === undefined ? {} : { requestId }) },
  });

  it("keeps two different permission requests apart and resolves only the one named", () => {
    const events = [
      approval("actor-1", 1_000, "req-a", "Bash: rm -rf build"),
      approval("actor-1", 2_000, "req-b", "Write: src/secrets.ts"),
    ];
    const both = assembleWorld(events, 3_000, coverage);
    expect(both.attention.map((a) => a.sourceRequestId)).toEqual(["req-a", "req-b"]);
    expect(both.actors[0]?.attentionIds).toHaveLength(2);

    const resolved = assembleWorld(
      [...events, approval("actor-1", 2_500, "req-a", "resolved", "attention_resolved")],
      3_000,
      coverage,
    );
    expect(resolved.attention.map((a) => a.sourceRequestId)).toEqual(["req-b"]);
  });

  it("folds an id-less duplicate (the permission Notification) into the open request", () => {
    const events = [
      approval("actor-1", 1_000, "req-a", "Bash: touch /tmp/x"),
      approval("actor-1", 1_500, undefined, "Claude needs your permission"),
    ];
    const world = assembleWorld(events, 2_000, coverage);
    expect(world.attention).toHaveLength(1);
    expect(world.attention[0]?.summary).toBe("Bash: touch /tmp/x"); // the richer signal wins
    expect(world.attention[0]?.updatedAt).toBe(1_500);
    expect(world.attention[0]?.openedAt).toBe(1_000);
  });
});

describe("assembleWorld: recovery fixture", () => {
  const events = replay("hooks-v2.1.235-recovery.jsonl");
  const world = assembleWorld(events, Math.max(...events.map((e) => e.occurredAt)) + 120_000, coverage);

  it("never lets a verified failing test stamp a milestone", () => {
    const receipts = deriveReceipts(events);
    const failed = receipts.find((r) => r.kind === "test_failed")!;
    const passed = receipts.find((r) => r.kind === "test_passed")!;
    expect(failed.confidence).toBe("verified"); // a real exit code, but not a delivery
    expect(failed.occurredAt).toBeLessThan(passed.occurredAt);

    const first = world.milestones.find((m) => m.key === "first_delivery")!;
    expect(first.achievedAt).toBe(passed.occurredAt);
    expect(first.achievedAt).not.toBe(failed.occurredAt);
    // test_passed + failure_recovered, never the failure itself.
    expect(first.current).toBe(2);
  });

  it("counts a verified failure_recovered receipt toward the recovery badge only", () => {
    const badge = world.milestones.find((m) => m.key === "recovery_badge")!;
    const recoveries = deriveReceipts(events).filter((r) => r.kind === "failure_recovered");
    expect(recoveries).toHaveLength(1);
    expect(recoveries[0]!.confidence).toBe("verified");
    expect(badge.current).toBe(1);
    expect(badge.target).toBe(10);
    expect(badge.achievedAt).toBeUndefined();
    // The other milestones count every verified receipt, which is more than the recoveries.
    expect(world.milestones.find((m) => m.key === "first_delivery")?.current).toBeGreaterThan(badge.current);
  });
});
