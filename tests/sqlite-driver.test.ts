import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterAll, expect, test } from "vitest";

import type { AgentEvent } from "#contracts/events.js";

// The store is not built yet. This proves the driver it will sit on behaves on the pinned Node
// version: WAL, transactions, and a real unique-constraint error, since dedupeKey must be unique
// in the DB. It also keeps the #contracts alias honest.

const dir = mkdtempSync(join(tmpdir(), "pockrew-sqlite-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const dedupeKey: AgentEvent["dedupeKey"] = "claude:session-1:PreToolUse:42";
const occurredAt: AgentEvent["occurredAt"] = 1_700_000_000_000;

test("node:sqlite supports WAL, transactions and unique constraints", () => {
  const db = new DatabaseSync(join(dir, "events.db"));

  db.exec("PRAGMA journal_mode = WAL");
  expect(db.prepare("PRAGMA journal_mode").get()).toMatchObject({ journal_mode: "wal" });

  db.exec("CREATE TABLE events (dedupeKey TEXT PRIMARY KEY, occurredAt INTEGER NOT NULL)");
  db.exec("BEGIN");
  db.prepare("INSERT INTO events VALUES (?, ?)").run(dedupeKey, occurredAt);
  db.exec("COMMIT");

  expect(db.prepare("SELECT COUNT(*) AS n FROM events").get()).toMatchObject({ n: 1 });
  expect(() => db.prepare("INSERT INTO events VALUES (?, ?)").run(dedupeKey, 1)).toThrow(/UNIQUE constraint failed/);

  db.close();
});
