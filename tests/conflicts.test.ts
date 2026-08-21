import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { fromHookPost } from "#adapters/claude/mapper.js";
import type { AgentEvent } from "#contracts/events.js";
import { deriveAttention, type AttentionOverlay } from "#core/attention/attention.js";
import { CONFLICT_WINDOW_MS, deriveConflicts } from "#core/conflicts/conflicts.js";
import { normalize } from "#core/normalize.js";

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

const write = (
  occurredAt: number,
  actorId: string,
  relativePath = "src/app.ts",
  over: Partial<AgentEvent> = {},
): AgentEvent =>
  ev({
    kind: "activity_completed",
    occurredAt,
    actorId,
    activity: { category: "code", tool: "Edit" },
    file: { relativePath, operation: "write" },
    ...over,
  });

describe("conflict detector: same-file P0 rule", () => {
  it("two actors writing the same path within 10 minutes → exactly one open conflict", () => {
    const items = deriveConflicts([write(1_000, "a1"), write(2_000, "a2")], 3_000);
    expect(items).toHaveLength(1);
    expect(items[0]!.type).toBe("conflict");
    expect(items[0]!.priority).toBe("high");
    expect(items[0]!.confidence).toBe("observed");
    expect(items[0]!.actorIds).toEqual(["a1", "a2"]);
    expect(items[0]!.summary).toBe("Overlapping work on src/app.ts");
    expect(items[0]!.summary).not.toMatch(/merge conflict/i);
  });

  it("repeated overlapping writes in one window keep one item and one id; updatedAt advances", () => {
    const first = deriveConflicts([write(1_000, "a1"), write(2_000, "a2")], 3_000);
    const more = deriveConflicts(
      [write(1_000, "a1"), write(2_000, "a2"), write(5_000, "a1"), write(9_000, "a2")],
      10_000,
    );
    expect(more).toHaveLength(1);
    expect(more[0]!.id).toBe(first[0]!.id);
    expect(more[0]!.updatedAt).toBe(9_000);
  });

  it("different paths, different projects, or the same actor twice never conflict", () => {
    expect(deriveConflicts([write(1_000, "a1", "a.ts"), write(2_000, "a2", "b.ts")], 3_000)).toHaveLength(0);
    expect(
      deriveConflicts([write(1_000, "a1"), write(2_000, "a2", "src/app.ts", { projectId: "/other" })], 3_000),
    ).toHaveLength(0);
    expect(deriveConflicts([write(1_000, "a1"), write(2_000, "a1")], 3_000)).toHaveLength(0);
  });

  it("a started-but-never-completed write never conflicts (denied/failed edits changed nothing)", () => {
    const started = ev({
      kind: "activity_started",
      occurredAt: 2_000,
      actorId: "a2",
      file: { relativePath: "src/app.ts", operation: "write" },
    });
    expect(deriveConflicts([write(1_000, "a1"), started], 3_000)).toHaveLength(0);
  });

  it("reads never conflict", () => {
    const read = ev({
      kind: "activity_completed",
      occurredAt: 2_000,
      actorId: "a2",
      file: { relativePath: "src/app.ts", operation: "read" },
    });
    expect(deriveConflicts([write(1_000, "a1"), read], 3_000)).toHaveLength(0);
  });

  it("cross-actor writes more than 10 minutes apart never conflict", () => {
    const later = 1_000 + CONFLICT_WINDOW_MS + 1;
    expect(deriveConflicts([write(1_000, "a1"), write(later, "a2")], later + 1)).toHaveLength(0);
  });

  it("a >10 min quiet gap starts a new window with a new id", () => {
    const w2Start = 2_000 + CONFLICT_WINDOW_MS + 100_000;
    const events = [write(1_000, "a1"), write(2_000, "a2"), write(w2Start, "a1"), write(w2Start + 1_000, "a2")];
    const early = deriveConflicts(events.slice(0, 2), 3_000);
    const late = deriveConflicts(events, w2Start + 2_000);
    expect(late).toHaveLength(1); // first window expired 10 min after its last overlap
    expect(late[0]!.openedAt).toBe(w2Start + 1_000);
    expect(late[0]!.id).not.toBe(early[0]!.id);
  });

  it("expires 10 quiet minutes after the last overlap", () => {
    const events = [write(1_000, "a1"), write(2_000, "a2")];
    expect(deriveConflicts(events, 2_000 + CONFLICT_WINDOW_MS - 1)).toHaveLength(1);
    expect(deriveConflicts(events, 2_000 + CONFLICT_WINDOW_MS)).toHaveLength(0);
  });

  it("resolves when either actor of the pair ends", () => {
    const events = [
      write(1_000, "a1"),
      write(2_000, "a2"),
      ev({ kind: "session_ended", occurredAt: 3_000, actorId: "a2" }),
    ];
    expect(deriveConflicts(events, 4_000)).toHaveLength(0);
  });

  it("resolves when BOTH actors' turns end; one turn ending alone keeps it open", () => {
    const turnStop = (occurredAt: number, actorId: string): AgentEvent =>
      ev({
        kind: "activity_completed",
        occurredAt,
        actorId,
        activity: { category: "coordination", operation: "turn_stop" },
      });
    const overlap = [write(1_000, "a1"), write(2_000, "a2")];
    expect(deriveConflicts([...overlap, turnStop(3_000, "a1")], 4_000)).toHaveLength(1); // a2 still mid-turn
    expect(deriveConflicts([...overlap, turnStop(3_000, "a1"), turnStop(3_500, "a2")], 4_000)).toHaveLength(0);
    // A new cross-actor write after both stops is a fresh overlap — it reopens.
    const reopened = deriveConflicts(
      [...overlap, turnStop(3_000, "a1"), turnStop(3_500, "a2"), write(5_000, "a1"), write(6_000, "a2")],
      7_000,
    );
    expect(reopened).toHaveLength(1);
  });

  it("three actors on one file → one item per overlapping pair", () => {
    const items = deriveConflicts([write(1_000, "a1"), write(2_000, "a2"), write(3_000, "a3")], 4_000);
    expect(items).toHaveLength(3);
    const pairs = items.map((it) => it.actorIds.join("+")).sort();
    expect(pairs).toEqual(["a1+a2", "a1+a3", "a2+a3"]);
  });
});

describe("conflict items through the attention queue", () => {
  it("appears in the queue and honors ack / resolve overlays", () => {
    const events = [write(1_000, "a1"), write(2_000, "a2")];
    const open = deriveAttention(events, 3_000);
    const conflict = open.find((it) => it.type === "conflict");
    expect(conflict).toBeDefined();

    const ack = new Map<string, AttentionOverlay>([[conflict!.id, { status: "acknowledged", updatedAt: 2_500 }]]);
    const acked = deriveAttention(events, 3_000, ack).find((it) => it.type === "conflict");
    expect(acked!.status).toBe("acknowledged");

    const resolve = new Map<string, AttentionOverlay>([[conflict!.id, { status: "resolved", updatedAt: 2_500 }]]);
    expect(deriveAttention(events, 3_000, resolve).some((it) => it.type === "conflict")).toBe(false);
  });
});

describe("conflict detector: real fixture replay", () => {
  it("a single-actor real session produces zero conflicts (no false positives)", () => {
    const lines = readFileSync(join(import.meta.dirname, "fixtures", "claude", "hooks-v2.1.235.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { receivedAt: number; body: unknown });
    const events = lines
      .map((line) => normalize(fromHookPost(line.body, line.receivedAt)))
      .filter((e): e is AgentEvent => e !== null);
    expect(events.length).toBeGreaterThan(0);
    const last = events[events.length - 1]!.occurredAt;
    expect(deriveConflicts(events, last + 1)).toHaveLength(0);
  });
});
