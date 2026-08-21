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
  expect(db.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 2 });
  expect(
    db
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name),
  ).toEqual([
    "actors",
    "app_state",
    "attention",
    "events",
    "file_touches",
    "milestones",
    "projects",
    "receipts",
    "town_layout",
    "world_layout",
  ]);
  db.close();
});

test("migrates an existing v1 database to v2 in place, keeping its data, then no-ops on reopen", () => {
  const dbPath = join(dir, "migrate.sqlite");
  // Hand-build exactly the v1 schema (pre-town_layout/world_layout) with one real row in it —
  // the shape openStore's very first CREATE TABLE block produced before this migration existed.
  const v1 = new DatabaseSync(dbPath);
  v1.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE actors (id TEXT PRIMARY KEY);
    CREATE TABLE events (
      dedupeKey TEXT PRIMARY KEY,
      occurredAt INTEGER NOT NULL,
      projectId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      actorId TEXT NOT NULL,
      kind TEXT NOT NULL,
      json TEXT NOT NULL
    );
    CREATE INDEX events_occurred_at_idx ON events (occurredAt);
    CREATE TABLE receipts (id TEXT PRIMARY KEY, occurredAt INTEGER NOT NULL, json TEXT NOT NULL);
    CREATE INDEX receipts_occurred_at_idx ON receipts (occurredAt);
    CREATE TABLE attention (id TEXT PRIMARY KEY);
    CREATE TABLE file_touches (id TEXT PRIMARY KEY);
    CREATE TABLE milestones (id TEXT PRIMARY KEY);
    CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    PRAGMA user_version = 1;
  `);
  v1.prepare(
    "INSERT INTO events (dedupeKey, occurredAt, projectId, sessionId, actorId, kind, json) VALUES (?,?,?,?,?,?,?)",
  ).run("dedupe-1", 1, "proj-1", "session-1", "actor-1", "session_started", JSON.stringify({ old: "data" }));
  v1.close();

  const migrated = openStore(dbPath);
  expect(migrated.listEvents()).toEqual([{ old: "data" }]); // pre-existing row survives untouched
  migrated.close();

  const check = new DatabaseSync(dbPath);
  expect(check.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 2 });
  expect(
    check
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name),
  ).toContain("town_layout");
  check.close();

  // Reopening an already-v2 database must be a no-op: no error, version unchanged.
  const reopened = openStore(dbPath);
  expect(reopened.listEvents()).toEqual([{ old: "data" }]);
  reopened.close();
  const final = new DatabaseSync(dbPath);
  expect(final.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 2 });
  final.close();
});

test("persists town and world layout rows idempotently, and never moves a placed cell", () => {
  const store = openStore(join(dir, "layout.sqlite"));

  store.placeStations([
    { projectId: "proj-1", station: "hq", x: 0, y: 0, placedAt: 1 },
    { projectId: "proj-1", station: "library", x: 1, y: 0, placedAt: 2 },
  ]);
  // INSERT OR IGNORE: a repeat call, even with a different (x, y), never moves the cell.
  store.placeStations([{ projectId: "proj-1", station: "hq", x: 9, y: 9, placedAt: 999 }]);
  expect(store.getTownLayouts(["proj-1"]).get("proj-1")).toEqual([
    { station: "hq", x: 0, y: 0 },
    { station: "library", x: 1, y: 0 },
  ]);
  expect(store.getTownLayouts(["proj-none"]).has("proj-none")).toBe(false);

  store.placeStations([{ projectId: "proj-2", station: "hq", x: 0, y: 0, placedAt: 3 }]);
  const batch = store.getTownLayouts(["proj-1", "proj-2", "proj-none"]);
  expect(batch.get("proj-1")).toEqual([
    { station: "hq", x: 0, y: 0 },
    { station: "library", x: 1, y: 0 },
  ]);
  expect(batch.get("proj-2")).toEqual([{ station: "hq", x: 0, y: 0 }]);
  expect(batch.has("proj-none")).toBe(false);
  expect(store.getTownLayouts([])).toEqual(new Map());

  store.placeWorldCells([{ projectId: "proj-1", x: 0, y: 0, placedAt: 1 }]);
  store.placeWorldCells([{ projectId: "proj-1", x: 5, y: 5, placedAt: 999 }]); // ignored: already placed
  store.placeWorldCells([{ projectId: "proj-2", x: 1, y: 0, placedAt: 2 }]);
  expect(store.getWorldLayout()).toEqual([
    { projectId: "proj-1", x: 0, y: 0 },
    { projectId: "proj-2", x: 1, y: 0 },
  ]);

  store.close();
});
