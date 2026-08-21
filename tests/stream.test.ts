import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import type { StreamMessage } from "#contracts/stream.js";
import type { WorldState } from "#contracts/world.js";
import { openStore } from "#core/store/store.js";
import { sourceCoverage } from "#server/coverage.js";
import { createApp, type ServerState } from "#server/http.js";

const dir = mkdtempSync(join(tmpdir(), "pockrew-stream-"));
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

const newApp = (name: string): ReturnType<typeof createApp> => {
  const store = openStore(join(dir, `${name}.sqlite`));
  afterAll(() => store.close());
  return createApp({ token, port: 4000, store, startedAt: 0 } satisfies ServerState);
};

type App = ReturnType<typeof createApp>;

const postEvent = (app: App, body: unknown): Promise<Response> =>
  app.request("/event", {
    method: "POST",
    headers: { "x-pockrew-token": token, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const getTicket = async (app: App): Promise<string> => {
  const res = await app.request("/api/stream-ticket", { method: "POST", headers: { "x-pockrew-token": token } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { ticket: string }).ticket;
};

/** Reads SSE frames off the response body until `count` messages have arrived. */
const readMessages = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  count: number,
): Promise<StreamMessage[]> => {
  const decoder = new TextDecoder();
  const messages: StreamMessage[] = [];
  let buffer = "";
  while (messages.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split = buffer.indexOf("\n\n");
    while (split !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const data = frame
        .split("\n")
        .find((l) => l.startsWith("data:"))
        ?.slice(5)
        .trim();
      if (data !== undefined) messages.push(JSON.parse(data) as StreamMessage);
      split = buffer.indexOf("\n\n");
    }
  }
  return messages;
};

describe("stream: ticket security", () => {
  const app = newApp("security");

  it("rejects POST /api/stream-ticket without the token", async () => {
    const res = await app.request("/api/stream-ticket", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("rejects the stream with no ticket at all", async () => {
    expect((await app.request("/api/stream")).status).toBe(401);
    expect((await app.request("/api/stream?ticket=")).status).toBe(401);
    expect((await app.request("/api/stream?ticket=made-up")).status).toBe(401);
  });

  it("rejects a foreign origin even on the ticket-authed stream route", async () => {
    const ticket = await getTicket(app);
    const res = await app.request(`/api/stream?ticket=${ticket}`, { headers: { origin: "http://evil.example" } });
    expect(res.status).toBe(403);
  });

  it("accepts a ticket once, then rejects the reuse", async () => {
    const ticket = await getTicket(app);
    const first = await app.request(`/api/stream?ticket=${ticket}`);
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toContain("text/event-stream");
    await first.body?.cancel();

    const reused = await app.request(`/api/stream?ticket=${ticket}`);
    expect(reused.status).toBe(401);
  });

  it("rejects a ticket older than its 30s lifetime", async () => {
    vi.useFakeTimers();
    try {
      const ticket = await getTicket(app);
      vi.advanceTimersByTime(30_001);
      const res = await app.request(`/api/stream?ticket=${ticket}`);
      expect(res.status).toBe(401);
    } finally {
      vi.useRealTimers();
    }
  });

  it("issues a fresh random ticket per request", async () => {
    const [a, b] = [await getTicket(app), await getTicket(app)];
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("stream: snapshot then patch", () => {
  const app = newApp("snapshot");
  const lines = fixtureLines();
  // One real session: its SessionStart plus its first tool call (a Read), from the same capture.
  const preToolUse = lines.find((l) => l.hook === "PreToolUse")!;
  const sessionId = (preToolUse.body as { session_id: string }).session_id;
  const sessionStart = lines.find(
    (l) => l.hook === "SessionStart" && (l.body as { session_id?: string }).session_id === sessionId,
  )!;

  it("sends a full snapshot first, then a patch replacing only the keys that changed", async () => {
    expect((await postEvent(app, sessionStart.body)).status).toBe(200);

    const ticket = await getTicket(app);
    const res = await app.request(`/api/stream?ticket=${ticket}`);
    const reader = res.body!.getReader();

    const [snapshot] = await readMessages(reader, 1);
    expect(snapshot?.type).toBe("snapshot");
    const world = (snapshot as Extract<StreamMessage, { type: "snapshot" }>).world;
    expect(world.actors).toHaveLength(1); // the session the fixture opened
    expect(world.projects).toHaveLength(1);
    expect(world.coverage.find((c) => c.source === "claude")?.status).toBe("healthy");
    expect(world.coverage.find((c) => c.source === "codex")?.status).toBe("offline");

    // A new real event mid-stream must arrive as a patch, not a second snapshot.
    expect((await postEvent(app, preToolUse.body)).status).toBe(200);
    const [patch] = await readMessages(reader, 1);
    expect(patch?.type).toBe("patch");
    const ops = (patch as Extract<StreamMessage, { type: "patch" }>).ops;
    const keys = ops.map((op) => op.key);

    expect(keys).toContain("actors");
    expect(keys).toContain("activities");
    // Nothing produced a receipt, an attention item or a coverage change, so those keys stay put.
    expect(keys).not.toContain("milestones");
    expect(keys).not.toContain("recentReceipts");
    expect(keys).not.toContain("attention");
    expect(keys).not.toContain("coverage");

    const actorsOp = ops.find((op) => op.key === "actors") as { key: "actors"; value: WorldState["actors"] };
    expect(actorsOp.value[0]?.station).toBe("library"); // the fixture's first tool call is a Read
    expect(actorsOp.value[0]?.currentActivityId).toBeDefined();

    await reader.cancel();
  });

  it("does not patch on a duplicate event (dedupeKey already stored)", async () => {
    expect((await postEvent(app, preToolUse.body)).status).toBe(200); // stable dedupeKey: tool_use_id
    const ticket = await getTicket(app);
    const res = await app.request(`/api/stream?ticket=${ticket}`);
    const reader = res.body!.getReader();
    await readMessages(reader, 1); // snapshot

    expect((await postEvent(app, preToolUse.body)).status).toBe(200); // same event again
    const raced = await Promise.race([
      readMessages(reader, 1).then(() => "patched"),
      new Promise<string>((resolve) => setTimeout(() => resolve("silent"), 150)),
    ]);
    expect(raced).toBe("silent");

    await reader.cancel();
  });
});

describe("stream: time-derived decay reaches connected clients", () => {
  const lines = fixtureLines();
  const sessionStart = lines.find((l) => l.hook === "SessionStart")!;

  it("patches an actor to idle after the reducer's idle window, with no new event", async () => {
    const app = newApp("decay");
    expect((await postEvent(app, sessionStart.body)).status).toBe(200);

    vi.useFakeTimers(); // installed before the connection, so the hub's tick is a fake one
    try {
      const ticket = await getTicket(app);
      const res = await app.request(`/api/stream?ticket=${ticket}`);
      const reader = res.body!.getReader();
      const [snapshot] = await readMessages(reader, 1);
      const world = (snapshot as Extract<StreamMessage, { type: "snapshot" }>).world;
      expect(world.actors[0]?.state).toBe("starting");

      // Nothing is POSTed here: only the clock moves past the 60s idle window.
      await vi.advanceTimersByTimeAsync(70_000);
      const [patch] = await readMessages(reader, 1);
      expect(patch?.type).toBe("patch");
      const ops = (patch as Extract<StreamMessage, { type: "patch" }>).ops;
      const actorsOp = ops.find((op) => op.key === "actors") as { key: "actors"; value: WorldState["actors"] };
      expect(actorsOp.value[0]?.state).toBe("idle");

      await reader.cancel();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("stream: a store outage never looks calm", () => {
  it("patches coverage to degraded for connected clients when a write fails", async () => {
    const real = openStore(join(dir, "degraded-stream.sqlite"));
    afterAll(() => real.close());
    // Reads keep working while writes fail — a busy lock, not a closed database.
    const store = {
      ...real,
      insertEvent: (): boolean => {
        throw new Error("database is locked");
      },
    };
    const app = createApp({ token, port: 4000, store, startedAt: 0 } satisfies ServerState);

    const ticket = await getTicket(app);
    const res = await app.request(`/api/stream?ticket=${ticket}`);
    const reader = res.body!.getReader();
    const [snapshot] = await readMessages(reader, 1);
    const world = (snapshot as Extract<StreamMessage, { type: "snapshot" }>).world;
    expect(world.coverage.every((c) => c.status === "offline")).toBe(true);

    const post = await postEvent(app, fixtureLines()[0]!.body);
    expect(post.status).toBe(503);

    const [patch] = await readMessages(reader, 1);
    const ops = (patch as Extract<StreamMessage, { type: "patch" }>).ops;
    const coverageOp = ops.find((op) => op.key === "coverage") as { key: "coverage"; value: WorldState["coverage"] };
    expect(coverageOp.value.every((c) => c.status === "degraded")).toBe(true);
    expect(coverageOp.value[0]?.message).toContain("pockrew doctor");

    await reader.cancel();
  });
});

describe("sourceCoverage: never invents healthy", () => {
  it("reports offline per source until events actually arrive", () => {
    const rows = sourceCoverage([]);
    expect(rows.map((r) => r.status)).toEqual(["offline", "offline"]);
    for (const r of rows) expect(r.message).toBeDefined();
  });

  it("reports degraded while a store write is failing", () => {
    const rows = sourceCoverage([], "disk I/O error — run: pockrew doctor");
    for (const r of rows) {
      expect(r.status).toBe("degraded");
      expect(r.message).toContain("pockrew doctor");
    }
  });
});
