import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { fromHookPost } from "#adapters/claude/mapper.js";
import type { AgentEvent } from "#contracts/events.js";
import {
  deriveAttention,
  ERROR_STREAK_MS,
  overlayForIntent,
  STALLED_AFTER_MS,
  type AttentionOverlay,
} from "#core/attention/attention.js";
import { normalize } from "#core/normalize.js";
import { dueNotifications, NOTIFY_REPEAT_MS } from "#server/notify.js";

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

const approval = (occurredAt: number, requestId: string, summary = "Bash: rm -rf tmp"): AgentEvent =>
  ev({ kind: "attention_requested", occurredAt, attention: { type: "approval", requestId, summary } });

const failed = (occurredAt: number, over: Partial<AgentEvent> = {}): AgentEvent =>
  ev({
    kind: "activity_failed",
    occurredAt,
    activity: { category: "terminal", tool: "Bash" },
    summary: "Exit code 1",
    ...over,
  });

describe("attention engine: requested items", () => {
  it("one permission request is one idempotent item; the id-less Notification folds in without vaguening the summary", () => {
    const items = deriveAttention(
      [
        approval(1_000, "r1"),
        ev({
          kind: "attention_requested",
          occurredAt: 1_100,
          attention: { type: "approval", summary: "needs your permission" },
        }),
      ],
      2_000,
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.type).toBe("approval");
    expect(items[0]!.priority).toBe("high");
    expect(items[0]!.summary).toBe("Bash: rm -rf tmp"); // detail from the id-carrying event wins
    expect(items[0]!.sourceRequestId).toBe("r1");
  });

  it("two different request ids never stitch into one card", () => {
    const items = deriveAttention([approval(1_000, "r1"), approval(1_200, "r2")], 2_000);
    expect(items).toHaveLength(2);
  });

  it("a later activity signal from the same actor expires the open prompt (provider request no longer valid)", () => {
    const items = deriveAttention(
      [approval(1_000, "r1"), ev({ kind: "activity_started", occurredAt: 1_500, activity: { category: "code" } })],
      2_000,
    );
    expect(items.filter((i) => i.type === "approval")).toHaveLength(0);
  });

  it("session end expires the actor's open prompts and errors — a dead session never asks forever", () => {
    const events = [approval(1_000, "r1"), failed(1_200), ev({ kind: "session_ended", occurredAt: 2_000 })];
    expect(deriveAttention(events, 3_000)).toHaveLength(0);
  });
});

describe("attention engine: error streaks (spec dedupe: 5 minutes)", () => {
  it("a repeated failure within 5 minutes updates the open item instead of spamming a new one", () => {
    const items = deriveAttention([failed(1_000), failed(1_000 + ERROR_STREAK_MS)], 2_000_000);
    expect(items).toHaveLength(1);
    expect(items[0]!.type).toBe("error");
    expect(items[0]!.summary).toContain("×2");
    expect(items[0]!.openedAt).toBe(1_000);
    expect(items[0]!.updatedAt).toBe(1_000 + ERROR_STREAK_MS);
  });

  it("a failure past the window replaces the stale item — one open error per actor/category", () => {
    const t2 = 1_000 + ERROR_STREAK_MS + 1;
    const items = deriveAttention([failed(1_000), failed(t2)], 2_000_000);
    expect(items).toHaveLength(1);
    expect(items[0]!.openedAt).toBe(t2);
  });

  it("any later activity signal is the recovery that clears the error", () => {
    const items = deriveAttention(
      [failed(1_000), ev({ kind: "activity_completed", occurredAt: 1_500, activity: { category: "terminal" } })],
      2_000,
    );
    expect(items.filter((i) => i.type === "error")).toHaveLength(0);
  });
});

describe("attention engine: stalled and coverage_gap", () => {
  const started = (occurredAt: number): AgentEvent =>
    ev({ kind: "activity_started", occurredAt, activity: { category: "code", tool: "Edit" } });

  it("an open activity past its window is stalled (normal, inferred); a completion clears it", () => {
    const now = 1_000 + STALLED_AFTER_MS + 60_000;
    const items = deriveAttention([started(1_000)], now);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "stalled", priority: "normal", confidence: "inferred" });
    expect(items[0]!.openedAt).toBe(1_000 + STALLED_AFTER_MS); // when it *became* stalled, stable across rebuilds

    const cleared = deriveAttention(
      [started(1_000), ev({ kind: "activity_completed", occurredAt: 2_000, activity: { category: "code" } })],
      now,
    );
    expect(cleared).toHaveLength(0);
  });

  it("an activity still inside its window is not stalled", () => {
    expect(deriveAttention([started(1_000)], 1_000 + STALLED_AFTER_MS - 1)).toHaveLength(0);
  });

  it("coverage_lost opens an info item; the matching restore closes it", () => {
    const lost = ev({
      kind: "coverage_lost",
      occurredAt: 1_000,
      projectId: "daemon",
      actorId: "daemon",
      confidence: "inferred",
      summary: "Daemon coverage lost — blind window starts (600s)",
    });
    const open = deriveAttention([lost], 2_000);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ type: "coverage_gap", priority: "info" });

    const restored = ev({ kind: "coverage_restored", occurredAt: 1_500, projectId: "daemon", actorId: "daemon" });
    expect(deriveAttention([lost, restored], 2_000)).toHaveLength(0);
  });
});

describe("attention lifecycle: overlays (ack / snooze / resolve)", () => {
  const base = [approval(1_000, "r1")];
  const overlay = (o: AttentionOverlay) => new Map([["attention:r1", o]]);

  it("ack keeps the item visible as acknowledged", () => {
    const items = deriveAttention(base, 2_000, overlay({ status: "acknowledged", updatedAt: 1_500 }));
    expect(items[0]!.status).toBe("acknowledged");
  });

  it("resolve removes it from the queue", () => {
    expect(deriveAttention(base, 2_000, overlay({ status: "resolved", updatedAt: 1_500 }))).toHaveLength(0);
  });

  it("snooze parks it until `until`, then it reopens on its own (lifecycle snoozed → open)", () => {
    const o = overlay({ status: "snoozed", snoozedUntil: 5_000, updatedAt: 1_500 });
    expect(deriveAttention(base, 2_000, o)[0]!.status).toBe("snoozed");
    expect(deriveAttention(base, 5_000, o)[0]!.status).toBe("open");
  });

  it("event truth wins: an overlay for an already-expired item never resurrects it", () => {
    const events = [...base, ev({ kind: "activity_started", occurredAt: 1_800, activity: { category: "code" } })];
    expect(deriveAttention(events, 2_000, overlay({ status: "acknowledged", updatedAt: 1_500 }))).toHaveLength(0);
  });

  it("a stale overlay never masks a newer real signal: a resolve before a fresh failure reopens the item", () => {
    // Same streak id (second failure inside the 5-minute window bumps updatedAt past the resolve).
    const events = [failed(1_000), failed(60_000)];
    const resolved = new Map([["attention:error:a1:terminal:1000", { status: "resolved" as const, updatedAt: 5_000 }]]);
    const items = deriveAttention(events, 100_000, resolved);
    expect(items).toHaveLength(1);
    expect(items[0]!.status).toBe("open");
  });
});

describe("attention engine: real fixture replay", () => {
  const lines = readFileSync(join(import.meta.dirname, "fixtures", "claude", "hooks-v2.1.235.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { receivedAt: number; body: unknown });
  const events = lines
    .map((line) => normalize(fromHookPost(line.body, line.receivedAt)))
    .filter((e): e is AgentEvent => e !== null);

  it("the real PermissionRequest opens exactly one approval item while the prompt is live", () => {
    const at = events.findIndex((e) => e.kind === "attention_requested");
    expect(at).toBeGreaterThan(-1);
    const upTo = events.slice(0, at + 1);
    const items = deriveAttention(upTo, upTo[at]!.occurredAt + 1_000);
    expect(items.filter((i) => i.type === "approval")).toHaveLength(1);
  });

  it("30 days after the sessions ended, nothing is left to show or to notify", () => {
    const later = Math.max(...events.map((e) => e.occurredAt)) + 30 * 86_400_000;
    const items = deriveAttention(events, later);
    expect(items).toEqual([]);
    expect(dueNotifications(items, new Map(), later)).toEqual([]);
  });
});

describe("overlayForIntent", () => {
  it("maps the three attention intents and rejects everything else", () => {
    expect(overlayForIntent({ kind: "attention_ack", id: "x" }, 1_000)?.overlay.status).toBe("acknowledged");
    expect(overlayForIntent({ kind: "attention_resolve", id: "x" }, 1_000)?.overlay.status).toBe("resolved");
    expect(overlayForIntent({ kind: "attention_snooze", id: "x", until: 2_000 }, 1_000)?.overlay).toEqual({
      status: "snoozed",
      snoozedUntil: 2_000,
      updatedAt: 1_000,
    });
    expect(overlayForIntent({ kind: "attention_snooze", id: "x", until: 500 }, 1_000)).toBeNull(); // past
    expect(overlayForIntent({ kind: "attention_ack" }, 1_000)).toBeNull(); // no id
    expect(overlayForIntent({ kind: "receipt_mark_reviewed", id: "x" }, 1_000)).toBeNull(); // not M4's
  });
});

describe("notifications: rate limit (1 per item, repeat after 10 minutes only while still high)", () => {
  const items = deriveAttention([approval(1_000, "r1")], 2_000);

  it("notifies an open high item once, then again only after the repeat window", () => {
    expect(dueNotifications(items, new Map(), 2_000)).toHaveLength(1);
    const log = new Map([["attention:r1", 2_000]]);
    expect(dueNotifications(items, log, 2_000 + NOTIFY_REPEAT_MS - 1)).toHaveLength(0);
    expect(dueNotifications(items, log, 2_000 + NOTIFY_REPEAT_MS)).toHaveLength(1);
  });

  it("acknowledged/snoozed items and normal/info priorities never notify", () => {
    const acked = items.map((i) => ({ ...i, status: "acknowledged" as const }));
    expect(dueNotifications(acked, new Map(), 2_000)).toHaveLength(0);
    const stalled = deriveAttention(
      [ev({ kind: "activity_started", occurredAt: 1_000, activity: { category: "code" } })],
      1_000 + STALLED_AFTER_MS + 1,
    );
    expect(stalled).toHaveLength(1); // in the tracker…
    expect(dueNotifications(stalled, new Map(), 1_000 + STALLED_AFTER_MS + 1)).toHaveLength(0); // …not the OS
  });
});

describe("ready_review producer (M5): one item per actor off the latest unreviewed review_ready receipt", () => {
  const turnWithWrite = (actorId: string, writeAt: number, stopAt: number, turnId: string): AgentEvent[] => [
    ev({
      kind: "activity_completed",
      occurredAt: writeAt,
      actorId,
      turnId,
      activity: { category: "code", tool: "Edit" },
      file: { relativePath: `src/${turnId}.ts`, operation: "write" },
    }),
    ev({
      kind: "activity_completed",
      occurredAt: stopAt,
      actorId,
      turnId,
      activity: { category: "coordination", operation: "turn_stop" },
    }),
  ];

  it("a turn that wrote files opens exactly one normal-priority item; a write-free turn opens none", () => {
    const items = deriveAttention(turnWithWrite("a1", 1_000, 2_000, "t1"), 3_000);
    const reviews = items.filter((i) => i.type === "ready_review");
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.priority).toBe("normal");
    expect(reviews[0]!.summary).toBe("Ready for review — 1 file(s)");

    const noWrites = deriveAttention(
      [
        ev({
          kind: "activity_completed",
          occurredAt: 1_000,
          activity: { category: "coordination", operation: "turn_stop" },
        }),
      ],
      2_000,
    );
    expect(noWrites.filter((i) => i.type === "ready_review")).toHaveLength(0);
  });

  it("a second turn updates the same item (id stable per actor, sourceRequestId moves to the latest receipt)", () => {
    const events = [...turnWithWrite("a1", 1_000, 2_000, "t1"), ...turnWithWrite("a1", 3_000, 4_000, "t2")];
    const reviews = deriveAttention(events, 5_000).filter((i) => i.type === "ready_review");
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.id).toBe("attention:ready_review:a1");
    expect(reviews[0]!.openedAt).toBe(2_000);
    expect(reviews[0]!.updatedAt).toBe(4_000);
  });

  it("marking the receipt reviewed clears the item; reviewing only the older one keeps the newer", () => {
    const one = turnWithWrite("a1", 1_000, 2_000, "t1");
    const oneItems = deriveAttention(one, 3_000).filter((i) => i.type === "ready_review");
    const receiptId = oneItems[0]!.sourceRequestId!;
    expect(
      deriveAttention(one, 3_000, new Map(), { reviewedReceiptIds: new Set([receiptId]) }).filter(
        (i) => i.type === "ready_review",
      ),
    ).toHaveLength(0);

    const two = [...one, ...turnWithWrite("a1", 3_000, 4_000, "t2")];
    const remaining = deriveAttention(two, 5_000, new Map(), { reviewedReceiptIds: new Set([receiptId]) }).filter(
      (i) => i.type === "ready_review",
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.updatedAt).toBe(4_000);
  });

  it("dies with its session (A10 expire — the receipt stays as the record) and honors a resolve overlay", () => {
    const live = turnWithWrite("a1", 1_000, 2_000, "t1");
    const item = deriveAttention(live, 4_000).filter((i) => i.type === "ready_review")[0]!;
    const resolved = deriveAttention(
      live,
      4_000,
      new Map([[item.id, { status: "resolved", updatedAt: 3_500 } as AttentionOverlay]]),
    );
    expect(resolved.filter((i) => i.type === "ready_review")).toHaveLength(0);

    const ended = [...live, ev({ kind: "session_ended", occurredAt: 3_000 })];
    expect(deriveAttention(ended, 4_000).filter((i) => i.type === "ready_review")).toHaveLength(0);
  });
});
