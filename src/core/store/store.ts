import { DatabaseSync } from "node:sqlite";

import type { AgentEvent } from "#contracts/events.js";
import type { WorkReceipt } from "#contracts/receipts.js";

export const openStore = (dbPath: string) => {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000"); // wait up to 5s on a lock before throwing SQLITE_BUSY

  const version = db.prepare("PRAGMA user_version").get()?.user_version;
  if (version === 0) {
    db.exec("BEGIN");
    try {
      db.exec(`
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
        CREATE TABLE receipts (
          id TEXT PRIMARY KEY,
          occurredAt INTEGER NOT NULL,
          json TEXT NOT NULL
        );
        CREATE INDEX receipts_occurred_at_idx ON receipts (occurredAt);
        CREATE TABLE attention (id TEXT PRIMARY KEY);
        CREATE TABLE file_touches (id TEXT PRIMARY KEY);
        CREATE TABLE milestones (id TEXT PRIMARY KEY);
        CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        PRAGMA user_version = 1;
      `);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      db.close();
      throw error;
    }
  }

  const insertEventStatement = db.prepare(`
    INSERT OR IGNORE INTO events
      (dedupeKey, occurredAt, projectId, sessionId, actorId, kind, json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const listEventsStatement = db.prepare("SELECT json FROM events ORDER BY occurredAt ASC, rowid ASC");
  const listEventsSinceStatement = db.prepare(
    "SELECT json FROM events WHERE occurredAt >= ? ORDER BY occurredAt ASC, rowid ASC",
  );
  const countEventsByKindStatement = db.prepare("SELECT kind, COUNT(*) as n FROM events GROUP BY kind");
  const insertReceiptStatement = db.prepare("INSERT OR IGNORE INTO receipts (id, occurredAt, json) VALUES (?, ?, ?)");
  const listReceiptsStatement = db.prepare("SELECT json FROM receipts ORDER BY occurredAt ASC, rowid ASC");
  const listReceiptsSinceStatement = db.prepare(
    "SELECT json FROM receipts WHERE occurredAt >= ? ORDER BY occurredAt ASC, rowid ASC",
  );
  const getAppStateStatement = db.prepare("SELECT value FROM app_state WHERE key = ?");
  const setAppStateStatement = db.prepare(`
    INSERT INTO app_state (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value
  `);

  return {
    insertEvent: (event: AgentEvent): boolean =>
      insertEventStatement.run(
        event.dedupeKey,
        event.occurredAt,
        event.projectId,
        event.sessionId,
        event.actorId,
        event.kind,
        JSON.stringify(event),
      ).changes === 1,
    listEvents: (opts?: { sinceOccurredAt?: number }): AgentEvent[] =>
      (opts?.sinceOccurredAt === undefined
        ? listEventsStatement.all()
        : listEventsSinceStatement.all(opts.sinceOccurredAt)
      ).map((row) => JSON.parse(row.json as string) as AgentEvent),
    countEventsByKind: (): Record<string, number> =>
      (countEventsByKindStatement.all() as Array<{ kind: string; n: number }>).reduce<Record<string, number>>(
        (acc, row) => {
          acc[row.kind] = row.n;
          return acc;
        },
        {},
      ),
    insertReceipt: (receipt: WorkReceipt): void => {
      insertReceiptStatement.run(receipt.id, receipt.occurredAt, JSON.stringify(receipt));
    },
    listReceipts: (opts?: { sinceOccurredAt?: number }): WorkReceipt[] =>
      (opts?.sinceOccurredAt === undefined
        ? listReceiptsStatement.all()
        : listReceiptsSinceStatement.all(opts.sinceOccurredAt)
      ).map((row) => JSON.parse(row.json as string) as WorkReceipt),
    getAppState: (key: string): string | undefined => getAppStateStatement.get(key)?.value as string | undefined,
    setAppState: (key: string, value: string): void => {
      setAppStateStatement.run(key, value);
    },
    close: (): void => db.close(),
  };
};

export type Store = ReturnType<typeof openStore>;
