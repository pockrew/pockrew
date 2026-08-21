import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import { openStore } from "#core/store/store.js";
import { assembleWorld } from "#core/world.js";
import { createApp, type ServerState } from "#server/http.js";

const dir = mkdtempSync(join(tmpdir(), "pockrew-intents-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const token = "test-token";

const permissionHook = {
  hook_event_name: "PermissionRequest",
  session_id: "s1",
  cwd: "/tmp/proj",
  prompt_id: "p1",
  tool_name: "Bash",
  tool_input: { command: "rm -rf tmp" },
  permission_mode: "default",
};

const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "x-pockrew-token": token, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/intents", () => {
  const dbPath = join(dir, "intents.sqlite");
  let store = openStore(dbPath);
  afterAll(() => store.close());
  const state: ServerState = { token, port: 4000, store, startedAt: 0 };
  const app = createApp(state);
  const itemId = "attention:s1:p1:Bash"; // normalize.ts requestId shape for PermissionRequest

  const worldAttention = () =>
    assembleWorld(store.listEvents(), Date.now(), [], store.getAttentionOverlays()).attention;

  it("requires the token like every endpoint", async () => {
    const res = await app.request("/api/intents", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });

  it("a real permission event opens exactly one item; ack keeps it visible as acknowledged", async () => {
    expect((await post(app, "/event", permissionHook)).status).toBe(200);
    expect(worldAttention()).toHaveLength(1);
    expect(worldAttention()[0]!.id).toBe(itemId);

    const res = await post(app, "/api/intents", { kind: "attention_ack", id: itemId });
    expect(res.status).toBe(200);
    expect(worldAttention()[0]!.status).toBe("acknowledged");
  });

  it("snooze parks the item; a past `until` is rejected", async () => {
    const until = Date.now() + 600_000;
    expect((await post(app, "/api/intents", { kind: "attention_snooze", id: itemId, until })).status).toBe(200);
    expect(worldAttention()[0]!.status).toBe("snoozed");
    expect((await post(app, "/api/intents", { kind: "attention_snooze", id: itemId, until: 1 })).status).toBe(400);
  });

  it("resolve removes it, is idempotent, and every accepted intent left an audit row", async () => {
    expect((await post(app, "/api/intents", { kind: "attention_resolve", id: itemId })).status).toBe(200);
    expect((await post(app, "/api/intents", { kind: "attention_resolve", id: itemId })).status).toBe(200);
    expect(worldAttention()).toHaveLength(0);
    expect(store.getAttentionOverlays().size).toBe(1); // one overlay row, not one per click

    const audit = store.listIntentAudit();
    expect(audit.map((a) => a.intent.kind)).toEqual([
      "attention_ack",
      "attention_snooze",
      "attention_resolve",
      "attention_resolve",
    ]);
  });

  it("the overlay survives a restart — a resolved item stays resolved", () => {
    store.close();
    store = openStore(dbPath);
    state.store = store;
    expect(store.getAttentionOverlays().get(itemId)?.status).toBe("resolved");
    expect(worldAttention()).toHaveLength(0);
  });

  it("rejects intents outside M4's scope and malformed bodies", async () => {
    expect((await post(app, "/api/intents", { kind: "receipt_mark_reviewed", id: "r" })).status).toBe(400);
    expect((await post(app, "/api/intents", { kind: "attention_ack" })).status).toBe(400); // no id
    const raw = await app.request("/api/intents", {
      method: "POST",
      headers: { "x-pockrew-token": token },
      body: "not json",
    });
    expect(raw.status).toBe(400);
  });
});

describe("ingest → notification wiring", () => {
  it("a stored permission event triggers exactly one notify check; duplicates trigger none", async () => {
    const store = openStore(join(dir, "notify.sqlite"));
    const notify = vi.fn();
    const app = createApp({ token, port: 4000, store, startedAt: 0 }, notify);

    expect((await post(app, "/event", permissionHook)).status).toBe(200);
    expect(notify).toHaveBeenCalledTimes(1);
    await post(app, "/event", permissionHook); // same dedupeKey: nothing new, nothing to ping
    expect(notify).toHaveBeenCalledTimes(1);
    store.close();
  });
});
