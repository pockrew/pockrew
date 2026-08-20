import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { fromHookPost } from "#adapters/claude/mapper.js";
import type { AgentEvent } from "#contracts/events.js";
import { normalize } from "#core/normalize.js";
import { deriveReceipts } from "#core/receipts/receipts.js";
import { defaultTimers, reduceActors } from "#core/reduce/reduce.js";
import { openStore } from "#core/store/store.js";
import { checkDaemonCoverage, HEARTBEAT_KEY } from "#server/coverage.js";
import { createApp, type ServerState } from "#server/http.js";

const dir = mkdtempSync(join(tmpdir(), "pockrew-ingest-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const token = "test-token";

type CaptureLine = { receivedAt: number; hook: string; body: unknown };

const fixtureLines = (): CaptureLine[] => {
  const file = join(import.meta.dirname, "fixtures", "claude", "hooks-v2.1.235.jsonl");
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as CaptureLine);
};

const postEvent = (app: ReturnType<typeof createApp>, body: unknown) =>
  app.request("/event", {
    method: "POST",
    headers: { "x-pockrew-token": token, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const dedupeByKey = (events: AgentEvent[]): AgentEvent[] => {
  const seen = new Set<string>();
  return events.filter((e) => (seen.has(e.dedupeKey) ? false : (seen.add(e.dedupeKey), true)));
};

describe("ingest: security", () => {
  const store = openStore(join(dir, "security.sqlite"));
  afterAll(() => store.close());
  const app = createApp({ token, port: 4000, store, startedAt: 0 });

  it("rejects a request with no token", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(401);
  });

  it("rejects a request with the wrong token", async () => {
    const res = await app.request("/api/health", { headers: { "x-pockrew-token": "wrong" } });
    expect(res.status).toBe(401);
  });

  it("rejects a request from a foreign origin", async () => {
    const res = await app.request("/api/health", {
      headers: { "x-pockrew-token": token, origin: "http://evil.example" },
    });
    expect(res.status).toBe(403);
  });
});

describe("ingest: fixture replay, restart and coverage", () => {
  const dbPath = join(dir, "company.sqlite");
  const lines = fixtureLines();
  // http.ts stamps occurredAt with Date.now() at POST time; fake the clock to the fixture's own
  // receivedAt for each line so the replay is faithful and comparable to an in-memory normalize.
  beforeAll(() => vi.useFakeTimers());
  afterAll(() => {
    vi.useRealTimers();
    store.close();
  });

  const expectedEvents = dedupeByKey(
    lines.map((l) => normalize(fromHookPost(l.body, l.receivedAt))).filter((e): e is AgentEvent => e !== null),
  );

  let store = openStore(dbPath);
  let app = createApp({ token, port: 4000, store, startedAt: 0 } satisfies ServerState);

  it("persists every mapped hook from the real fixture via POST /event", async () => {
    for (const line of lines) {
      vi.setSystemTime(line.receivedAt);
      const res = await postEvent(app, line.body);
      expect(res.status).toBe(200);
    }
    const persisted = store.listEvents();
    expect(persisted.map((e) => e.dedupeKey).sort()).toEqual(expectedEvents.map((e) => e.dedupeKey).sort());
  });

  it("never fatal on malformed JSON — 400, not a crash", async () => {
    const res = await postEvent(app, "not json");
    expect(res.status).toBe(400);
  });

  it("does not duplicate a row when the same line is POSTed again", async () => {
    const before = store.listEvents().length;
    vi.setSystemTime(lines[0]!.receivedAt);
    await postEvent(app, lines[0]!.body);
    expect(store.listEvents()).toHaveLength(before);
  });

  it("round-trips through a restart: DB replay drives reduceActors/deriveReceipts identically to an in-memory replay", () => {
    store.close();
    store = openStore(dbPath);
    const fromDb = store.listEvents();
    expect(fromDb).toHaveLength(expectedEvents.length);

    const now = Math.max(...fromDb.map((e) => e.occurredAt)) + defaultTimers.endedHoldMs + 60_000;
    expect(reduceActors(fromDb, now)).toEqual(reduceActors(expectedEvents, now));
    expect(deriveReceipts(fromDb)).toEqual(deriveReceipts(expectedEvents));

    app = createApp({ token, port: 4000, store, startedAt: 0 } satisfies ServerState);
  });
});

describe("ingest: daemon coverage heartbeat", () => {
  const store = openStore(join(dir, "coverage.sqlite"));
  afterAll(() => store.close());

  it("does nothing on first run: no heartbeat recorded yet", () => {
    checkDaemonCoverage(store, 1_000_000);
    expect(store.listEvents()).toHaveLength(0);
  });

  it("a fresh heartbeat (daemon was up, just idle) means no blind window even after a restart", () => {
    const lastAlive = 5_000_000;
    store.setAppState(HEARTBEAT_KEY, String(lastAlive));
    checkDaemonCoverage(store, lastAlive + 30_000); // under the blind-window threshold
    expect(store.listEvents()).toHaveLength(0);
  });

  it("records exactly one coverage_lost/coverage_restored pair on a real gap, and stays idempotent", () => {
    const last = 10_000_000;
    store.setAppState(HEARTBEAT_KEY, String(last));
    const now = last + 10 * 60_000; // well past the blind-window threshold

    checkDaemonCoverage(store, now);
    let events = store.listEvents();
    const lost = events.filter((e) => e.kind === "coverage_lost");
    const restored = events.filter((e) => e.kind === "coverage_restored");
    expect(lost).toHaveLength(1);
    expect(restored).toHaveLength(1);
    expect(lost[0]!.occurredAt).toBe(last);
    expect(restored[0]!.occurredAt).toBe(now);
    expect(lost[0]!.confidence).toBe("inferred"); // measured gap, not a verified outcome

    checkDaemonCoverage(store, now); // same args again — dedupeKey stops a duplicate row
    events = store.listEvents();
    expect(events.filter((e) => e.kind === "coverage_lost")).toHaveLength(1);
    expect(events.filter((e) => e.kind === "coverage_restored")).toHaveLength(1);
  });

  it("never guesses a gap from a garbage heartbeat value", () => {
    const before = store.listEvents().length;
    store.setAppState(HEARTBEAT_KEY, "not-a-number");
    checkDaemonCoverage(store, 20_000_000);
    expect(store.listEvents()).toHaveLength(before); // no new rows
  });

  it("recovers a pair after a crash between the two inserts, without a retry duplicating the first", () => {
    const last = 30_000_000;
    store.setAppState(HEARTBEAT_KEY, String(last));
    // Simulate the crash: only coverage_lost made it in before the process died.
    store.insertEvent({
      id: `daemon:coverage_lost:${last}`,
      dedupeKey: `daemon:coverage_lost:${last}`,
      occurredAt: last,
      observedAt: last,
      source: "claude",
      confidence: "inferred",
      projectId: "daemon",
      sessionId: "daemon",
      actorId: "daemon",
      kind: "coverage_lost",
      summary: "Daemon coverage lost — blind window starts (crash-sim)",
    });

    const retryNow = last + 20 * 60_000;
    checkDaemonCoverage(store, retryNow); // heartbeat never got updated after the crash
    const events = store.listEvents().filter((e) => e.dedupeKey.endsWith(`:${last}`));
    expect(events.filter((e) => e.kind === "coverage_lost")).toHaveLength(1); // no duplicate
    expect(events.filter((e) => e.kind === "coverage_restored")).toHaveLength(1); // now paired
    expect(events.find((e) => e.kind === "coverage_restored")?.occurredAt).toBe(retryNow);
  });
});

describe("ingest: store failure surfaces as degraded, never silent", () => {
  it("503s on a write failure; /api/health reports degraded with repair guidance", async () => {
    const failStore = openStore(join(dir, "degraded.sqlite"));
    const failApp = createApp({ token, port: 4000, store: failStore, startedAt: 0 } satisfies ServerState);
    failStore.close(); // simulate a busy/corrupt store: any further statement throws

    const res = await postEvent(failApp, { hook_event_name: "SessionStart", session_id: "s1", cwd: "/tmp/proj" });
    expect(res.status).toBe(503);

    const health = await failApp.request("/api/health", { headers: { "x-pockrew-token": token } });
    const body = (await health.json()) as { ok?: boolean; degraded?: boolean; guidance?: string };
    expect(body.ok).toBe(false);
    expect(body.degraded).toBe(true);
    expect(body.guidance).toContain("pockrew doctor");
  });
});
