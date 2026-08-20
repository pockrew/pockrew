import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { fromHookPost } from "#adapters/claude/mapper.js";
import type { AgentEvent } from "#contracts/events.js";
import { normalize } from "#core/normalize.js";
import { defaultTimers, reduceActors } from "#core/reduce/reduce.js";

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

describe("reduceActors: claude hook fixture replay", () => {
  const events = replayClaudeFixture();
  const lastOccurredAt = Math.max(...events.map((e) => e.occurredAt));
  // Long after the fixture ends, and past every hold window: every session should read "ended" —
  // except one, whose SessionEnd(prompt_input_exit) fires with the PermissionRequest still open;
  // waiting_user must survive being masked by ended (see spec precedence).
  const now = lastOccurredAt + defaultTimers.endedHoldMs + 60_000;
  const actors = reduceActors(events, now);

  it("ends every main session actor once SessionEnd was observed, except an unresolved approval", () => {
    const sessionActors = actors.filter((a) => a.id === a.sessionId);
    expect(sessionActors.length).toBeGreaterThan(0);
    const ended = sessionActors.filter((a) => a.state === "ended");
    const stillWaiting = sessionActors.filter((a) => a.state === "waiting_user");
    expect(ended.length).toBe(sessionActors.length - 1);
    expect(stillWaiting.length).toBe(1);
  });

  it("keeps the subagent actor, parented to its session", () => {
    const subagent = actors.find((a) => a.parentActorId !== undefined);
    expect(subagent).toBeDefined();
    expect(subagent?.parentActorId).toBe(subagent?.sessionId);
  });
});

const evt = (partial: Partial<AgentEvent> & Pick<AgentEvent, "actorId" | "occurredAt" | "kind">): AgentEvent => ({
  id: `${partial.actorId}:${partial.kind}:${partial.occurredAt}`,
  dedupeKey: partial.dedupeKey ?? `${partial.actorId}:${partial.kind}:${partial.occurredAt}`,
  observedAt: partial.occurredAt,
  source: "claude",
  confidence: "observed",
  projectId: "proj",
  sessionId: "session-1",
  ...partial,
});

describe("reduceActors: synthetic state machine", () => {
  it("gives the same result regardless of arrival order", () => {
    const ordered = [
      evt({ actorId: "a", kind: "session_started", occurredAt: 0 }),
      evt({ actorId: "a", kind: "prompt_submitted", occurredAt: 1_000 }),
      evt({ actorId: "a", kind: "activity_started", occurredAt: 2_000 }),
    ];
    const shuffled = [ordered[2]!, ordered[0]!, ordered[1]!];
    const now = 3_000;
    expect(reduceActors(shuffled, now)).toEqual(reduceActors(ordered, now));
  });

  it("applies a duplicate dedupeKey once, keeping the first event's effect", () => {
    const first = evt({ actorId: "a", kind: "activity_started", occurredAt: 1_000, dedupeKey: "dup" });
    // Same dedupeKey re-delivered with a different kind — must be ignored, not re-applied.
    const resend = evt({ actorId: "a", kind: "activity_failed", occurredAt: 5_000, dedupeKey: "dup" });
    const now = 1_500;
    const [actor] = reduceActors([first, resend], now);
    expect(actor?.state).toBe("working");
  });

  it("thinking holds only while process_alive is newer than the last signal", () => {
    const base = [
      evt({ actorId: "a", kind: "session_started", occurredAt: 0 }),
      evt({ actorId: "a", kind: "prompt_submitted", occurredAt: 1_000 }),
    ];
    const withHeartbeat = [...base, evt({ actorId: "a", kind: "process_alive", occurredAt: 2_000 })];
    const now = 1_000 + defaultTimers.thinkingAfterMs + 1;

    const [thinking] = reduceActors(withHeartbeat, now);
    expect(thinking?.state).toBe("thinking");
    expect(thinking?.stateConfidence).toBe("inferred");

    const [unknown] = reduceActors(base, now);
    expect(unknown?.state).toBe("unknown");
  });

  it("goes idle after idleAfterMs with no signal on a live session", () => {
    const events = [evt({ actorId: "a", kind: "session_started", occurredAt: 0 })];
    const now = defaultTimers.idleAfterMs + 1;
    const [actor] = reduceActors(events, now);
    expect(actor?.state).toBe("idle");
    expect(actor?.stateConfidence).toBe("inferred");
  });

  it("completed celebrates for completedHoldMs then decays to idle", () => {
    const events = [
      evt({ actorId: "a", kind: "session_started", occurredAt: 0 }),
      evt({ actorId: "a", kind: "task_completed", occurredAt: 1_000, confidence: "verified" }),
    ];
    const stillCelebrating = reduceActors(events, 1_000 + defaultTimers.completedHoldMs - 1)[0];
    expect(stillCelebrating?.state).toBe("completed");
    expect(stillCelebrating?.stateConfidence).toBe("verified");

    const decayed = reduceActors(events, 1_000 + defaultTimers.completedHoldMs + 1)[0];
    expect(decayed?.state).toBe("idle");
  });

  it("marks an open activity past its window unknown rather than assuming completion", () => {
    const events = [
      evt({ actorId: "a", kind: "session_started", occurredAt: 0 }),
      evt({ actorId: "a", kind: "activity_started", occurredAt: 1_000 }),
    ];
    const now = 1_000 + defaultTimers.activityWindowMs + 1;
    const [actor] = reduceActors(events, now);
    expect(actor?.state).toBe("unknown");
    expect(actor?.stateConfidence).toBe("inferred");
  });

  it("waiting_user takes precedence over an open activity", () => {
    const events = [
      evt({ actorId: "a", kind: "session_started", occurredAt: 0 }),
      evt({ actorId: "a", kind: "activity_started", occurredAt: 1_000 }),
      evt({
        actorId: "a",
        kind: "attention_requested",
        occurredAt: 2_000,
        attention: { type: "approval", summary: "run rm -rf" },
      }),
    ];
    const [actor] = reduceActors(events, 2_500);
    expect(actor?.state).toBe("waiting_user");
  });

  it("waiting_user takes precedence over ended (an unresolved approval must not be hidden)", () => {
    const events = [
      evt({ actorId: "a", kind: "session_started", occurredAt: 0 }),
      evt({
        actorId: "a",
        kind: "attention_requested",
        occurredAt: 1_000,
        attention: { type: "approval", summary: "run rm -rf" },
      }),
      evt({ actorId: "a", kind: "session_ended", occurredAt: 2_000 }),
    ];
    const [actor] = reduceActors(events, 2_500);
    expect(actor?.state).toBe("waiting_user");
  });

  it("working (an open activity within its window) takes precedence over ended", () => {
    const events = [
      evt({ actorId: "a", kind: "session_started", occurredAt: 0 }),
      evt({ actorId: "a", kind: "activity_started", occurredAt: 1_000 }),
      evt({ actorId: "a", kind: "session_ended", occurredAt: 1_500 }),
    ];
    const [actor] = reduceActors(events, 2_000);
    expect(actor?.state).toBe("working");
  });

  it("ended wins once a completion's hold has expired and nothing else is open", () => {
    const events = [
      evt({ actorId: "a", kind: "session_started", occurredAt: 0 }),
      evt({ actorId: "a", kind: "task_completed", occurredAt: 1_000, confidence: "verified" }),
      evt({ actorId: "a", kind: "session_ended", occurredAt: 2_000 }),
    ];
    const now = 1_000 + defaultTimers.completedHoldMs + 1;
    const [actor] = reduceActors(events, now);
    expect(actor?.state).toBe("ended");
  });

  it("ended wins over a stale open activity past its window (unknown loses to ended)", () => {
    const events = [
      evt({ actorId: "a", kind: "session_started", occurredAt: 0 }),
      evt({ actorId: "a", kind: "activity_started", occurredAt: 1_000 }),
      evt({ actorId: "a", kind: "session_ended", occurredAt: 1_500 }),
    ];
    const now = 1_000 + defaultTimers.activityWindowMs + 1;
    const [actor] = reduceActors(events, now);
    expect(actor?.state).toBe("ended");
  });

  it("a process_alive that arrives after session_ended cannot keep thinking alive", () => {
    const events = [
      evt({ actorId: "a", kind: "session_started", occurredAt: 0 }),
      evt({ actorId: "a", kind: "prompt_submitted", occurredAt: 1_000 }),
      evt({ actorId: "a", kind: "session_ended", occurredAt: 1_300 }),
      evt({ actorId: "a", kind: "process_alive", occurredAt: 1_400 }),
    ];
    const [actor] = reduceActors(events, 46_400);
    expect(actor?.state).toBe("ended");
  });

  it("never creates an actor from world-scoped daemon coverage events", () => {
    const events = [
      evt({ actorId: "daemon", kind: "coverage_lost", occurredAt: 0 }),
      evt({ actorId: "daemon", kind: "coverage_restored", occurredAt: 1_000 }),
    ];
    expect(reduceActors(events, 2_000)).toHaveLength(0);
  });
});
