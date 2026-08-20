import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterAll, expect, test } from "vitest";

import type { AgentEvent } from "#contracts/events.js";
import type { WorkReceipt } from "#contracts/receipts.js";
import { openStore } from "#core/store/store.js";

const dir = mkdtempSync(join(tmpdir(), "pockrew-store-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const event: AgentEvent = {
  id: "event-1",
  dedupeKey: "claude:session-1:activity-1",
  occurredAt: 100,
  observedAt: 101,
  source: "claude",
  sourceVersion: "2.1.235",
  confidence: "verified",
  permissionMode: "default",
  projectId: "project-1",
  sessionId: "session-1",
  actorId: "actor-1",
  parentActorId: "actor-parent",
  turnId: "turn-1",
  kind: "activity_completed",
  activity: {
    category: "code",
    tool: "Edit",
    operation: "write",
    exitCode: 0,
    approvedBy: "human",
  },
  summary: "Updated the store",
  rawRef: "fixture:1",
};

const laterEvent: AgentEvent = {
  id: "event-2",
  dedupeKey: "claude:session-1:ended",
  occurredAt: 200,
  observedAt: 201,
  source: "claude",
  confidence: "observed",
  projectId: "project-1",
  sessionId: "session-1",
  actorId: "actor-1",
  kind: "session_ended",
};

const receipt: WorkReceipt = {
  id: "receipt-1",
  projectId: "project-1",
  actorId: "actor-1",
  sessionId: "session-1",
  turnId: "turn-1",
  kind: "test_passed",
  title: "Store tests passed",
  summary: "The SQLite store passed its test",
  confidence: "verified",
  occurredAt: 150,
  durationMs: 20,
  files: ["src/core/store/store.ts"],
  git: { repoRoot: ".", branch: "main", commit: "abc123" },
  evidence: [{ type: "exit_code", ref: "command-1", label: "exit 0" }],
};

const laterReceipt: WorkReceipt = {
  id: "receipt-2",
  projectId: "project-1",
  actorId: "actor-1",
  sessionId: "session-1",
  kind: "review_ready",
  title: "Store ready for review",
  confidence: "observed",
  occurredAt: 250,
  evidence: [{ type: "source_event", ref: "event-2", label: "turn stopped" }],
};

test("persists events, receipts and app state idempotently", () => {
  const dbPath = join(dir, "company.sqlite");
  const store = openStore(dbPath);

  expect(store.insertEvent(event)).toBe(true);
  expect(store.insertEvent(event)).toBe(false);
  expect(store.listEvents()).toEqual([event]);
  expect(Object.hasOwn(store.listEvents()[0]!, "attention")).toBe(false);
  expect(store.insertEvent(laterEvent)).toBe(true);
  expect(store.listEvents({ sinceOccurredAt: 200 })).toEqual([laterEvent]);
  expect(store.countEventsByKind()).toEqual({ activity_completed: 1, session_ended: 1 });

  store.insertReceipt(receipt);
  store.insertReceipt(receipt);
  store.insertReceipt(laterReceipt);
  expect(store.listReceipts()).toEqual([receipt, laterReceipt]);
  expect(store.listReceipts({ sinceOccurredAt: 250 })).toEqual([laterReceipt]);

  expect(store.getAppState("view")).toBeUndefined();
  store.setAppState("view", "world");
  expect(store.getAppState("view")).toBe("world");
  store.setAppState("view", "receipts");
  expect(store.getAppState("view")).toBe("receipts");
  store.close();

  const reopened = openStore(dbPath);
  expect(reopened.listEvents()).toEqual([event, laterEvent]);
  expect(reopened.listReceipts()).toEqual([receipt, laterReceipt]);
  expect(reopened.getAppState("view")).toBe("receipts");
  reopened.close();

  const db = new DatabaseSync(dbPath);
  expect(db.prepare("PRAGMA journal_mode").get()).toMatchObject({ journal_mode: "wal" });
  expect(db.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 1 });
  expect(
    db
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name),
  ).toEqual(["actors", "app_state", "attention", "events", "file_touches", "milestones", "projects", "receipts"]);
  db.close();
});
