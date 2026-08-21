import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import type { ShiftReport } from "#contracts/reports.js";
import { openStore } from "#core/store/store.js";
import { assembleWorld } from "#core/world.js";
import { createApp, type ServerState } from "#server/http.js";
import { LAST_SEEN_KEY, readReviewedReceipts, REVIEWED_RECEIPTS_KEY } from "#server/stream.js";

const dir = mkdtempSync(join(tmpdir(), "pockrew-report-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const token = "test-token";

const hook = (over: Record<string, unknown>): Record<string, unknown> => ({
  session_id: "s1",
  cwd: "/tmp/proj",
  ...over,
});

const request = (app: ReturnType<typeof createApp>, path: string, init: RequestInit = {}) =>
  app.request(path, {
    ...init,
    headers: { "x-pockrew-token": token, "content-type": "application/json", ...init.headers },
  });

describe("GET /api/report + report_seen", () => {
  const store = openStore(join(dir, "report.sqlite"));
  afterAll(() => store.close());
  const state: ServerState = { token, port: 4000, store, startedAt: 0 };
  const app = createApp(state);

  it("requires the token", async () => {
    expect((await app.request("/api/report")).status).toBe(401);
  });

  it("rejects a non-numeric from", async () => {
    expect((await request(app, "/api/report?from=abc")).status).toBe(400);
  });

  it("reports the window since the cursor: shipped stays verified-only, activity lands observed", async () => {
    // A completed turn with a written file (observed receipt + changed section)…
    const post = (body: unknown) => request(app, "/event", { method: "POST", body: JSON.stringify(body) });
    await post(
      hook({
        hook_event_name: "PostToolUse",
        tool_name: "Edit",
        tool_input: { file_path: "/tmp/proj/src/a.ts" },
        tool_use_id: "t1",
      }),
    );
    await post(hook({ hook_event_name: "Stop" }));

    const res = await request(app, "/api/report");
    expect(res.status).toBe(200);
    const report = (await res.json()) as ShiftReport;
    expect(report.shipped).toHaveLength(0); // nothing verified in this session
    expect(report.noVerifiedOutcome).toBe("Agents were active, but no verified outcome was captured.");
    expect(report.completedActivity.length).toBeGreaterThan(0);
    expect(report.changed).toEqual([{ projectId: "/tmp/proj", files: ["src/a.ts"] }]);
  });

  it("?from= overrides the cursor and excludes everything at or before it", async () => {
    const future = Date.now() + 60_000;
    const res = await request(app, `/api/report?from=${future}`);
    const report = (await res.json()) as ShiftReport;
    expect(report.from).toBe(future);
    expect(report.completedActivity).toHaveLength(0);
    expect(report.changed).toHaveLength(0);
    expect(report.noVerifiedOutcome).toBeUndefined(); // empty window: "nothing happened", not a lie
  });

  it("report_seen moves the presence cursor and audits; a bad cursor is rejected", async () => {
    const cursor = Date.now();
    const res = await request(app, "/api/intents", {
      method: "POST",
      body: JSON.stringify({ kind: "report_seen", cursor }),
    });
    expect(res.status).toBe(200);
    expect(store.getAppState(LAST_SEEN_KEY)).toBe(String(cursor));
    expect(store.listIntentAudit().some((row) => row.intent.kind === "report_seen")).toBe(true);

    const bad = await request(app, "/api/intents", {
      method: "POST",
      body: JSON.stringify({ kind: "report_seen", cursor: "yesterday" }),
    });
    expect(bad.status).toBe(400);

    const after = (await (await request(app, "/api/report")).json()) as ShiftReport;
    expect(after.from).toBe(cursor); // the default window now starts at the seen cursor
  });

  it("receipt_mark_reviewed persists idempotently and flips the world's reviewed flag", async () => {
    const world = () =>
      assembleWorld(store.listEvents(), Date.now(), [], store.getAttentionOverlays(), readReviewedReceipts(store));
    const receipt = world().recentReceipts[0];
    expect(receipt).toBeDefined(); // the Stop event above produced a turn_completed receipt
    expect(receipt!.reviewed).toBe(false);

    const mark = () =>
      request(app, "/api/intents", {
        method: "POST",
        body: JSON.stringify({ kind: "receipt_mark_reviewed", id: receipt!.id }),
      });
    expect((await mark()).status).toBe(200);
    expect((await mark()).status).toBe(200); // double click: same flag, no second entry
    expect(JSON.parse(store.getAppState(REVIEWED_RECEIPTS_KEY)!)).toEqual([receipt!.id]);
    expect(world().recentReceipts.find((r) => r.id === receipt!.id)!.reviewed).toBe(true);

    const bad = await request(app, "/api/intents", {
      method: "POST",
      body: JSON.stringify({ kind: "receipt_mark_reviewed", id: "" }),
    });
    expect(bad.status).toBe(400);
  });
});
