import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";

import { fromHookPost } from "#adapters/claude/mapper.js";
import type { UserIntent } from "#contracts/intents.js";
import { deriveAttention, overlayForIntent } from "#core/attention/attention.js";
import { normalize } from "#core/normalize.js";
import { deriveReceipts } from "#core/receipts/receipts.js";
import { buildShiftReport } from "#core/reports/reports.js";
import type { Store } from "#core/store/store.js";
import { sourceCoverage } from "#server/coverage.js";
import { createStreamHub, LAST_SEEN_KEY, readReviewedReceipts, REVIEWED_RECEIPTS_KEY } from "#server/stream.js";

export type ServerState = {
  token: string;
  port: number;
  store: Store;
  startedAt: number;
  /** Set when the store throws (busy or corrupt); cleared on the next successful write. Surfaced
   *  in /api/health rather than silently dropping events (spec: "busy or corrupt DB surfaces a
   *  coverage gap with repair guidance and never silently resets"). */
  storeFailedAt?: number | undefined;
  lastStoreError?: string | undefined;
};

const REPAIR_GUIDANCE = "database busy or corrupt — check disk space and file permissions, then run: pockrew doctor";

/** The built web app: vite's outDir (`dist/web`), one level up from src/server and dist/server alike. */
export const webRoot = (): string => fileURLToPath(new URL("../../dist/web", import.meta.url));

/** False until `pnpm build` ran; unbuilt is not an error — `pnpm dev` serves the app from vite. */
export const webBuilt = (): boolean => existsSync(webRoot());

/**
 * One extra allowed origin for `pnpm dev`, where vite serves the app (expected value
 * `http://localhost:5173`) and proxies /api here, so the browser sends vite's origin and not the
 * daemon's. Only a loopback host is honoured — the env var must never be able to allowlist a
 * remote site — and anything else, unparseable or unset, means the security default: no extra
 * origin at all.
 */
const devOrigin = (): string | undefined => {
  const raw = process.env["POCKREW_DEV_ORIGIN"];
  if (raw === undefined) return undefined;
  try {
    const url = new URL(raw);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" ? url.origin : undefined;
  } catch {
    return undefined; // not a URL: ignored, never trusted verbatim
  }
};

/** The store failure message the world's coverage rows carry while a write is failing. */
const storeFailure = (state: ServerState): string | undefined =>
  state.storeFailedAt === undefined
    ? undefined
    : `${state.lastStoreError ?? "store write failed"} — ${REPAIR_GUIDANCE}`;

/** `notify` runs after every stored event so the daemon can ping the OS even with no client
 *  connected (cli.ts passes the notifier; tests omit it and stay silent). */
export const createApp = (state: ServerState, notify?: () => void): Hono => {
  const app = new Hono();
  const stream = createStreamHub({
    store: state.store,
    coverage: (events) => sourceCoverage(events, storeFailure(state)),
  });

  app.use("*", async (c, next) => {
    // Every API endpoint requires the token (spec: security). Two exceptions:
    // - GET /api/stream — EventSource cannot set a header, so it authenticates with a single-use
    //   ticket and validates that itself.
    // - the static web app — the token travels in the URL fragment, which the browser never sends,
    //   so the page itself has to be fetchable without it. It carries no user data; the API does.
    const api = c.req.path.startsWith("/api") || c.req.path === "/event";
    const ticketAuthed = c.req.method === "GET" && c.req.path === "/api/stream";
    const token = c.req.header("x-pockrew-token");
    if (api && !ticketAuthed && token !== state.token) return c.json({ error: "unauthorized" }, 401);
    const origin = c.req.header("origin");
    if (origin !== undefined) {
      // POCKREW_DEV_ORIGIN opts in one extra local origin for `pnpm dev` (see devOrigin).
      const allowed = [`http://127.0.0.1:${state.port}`, `http://localhost:${state.port}`, devOrigin()];
      if (!allowed.includes(origin)) return c.json({ error: "forbidden origin" }, 403);
    }
    await next();
  });

  app.post("/event", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "malformed" }, 400); // logged-and-skipped, never fatal
    }
    const event = normalize(fromHookPost(payload, Date.now()));
    if (!event) return c.json({ ok: true });
    try {
      const inserted = state.store.insertEvent(event); // idempotent on dedupeKey
      state.storeFailedAt = undefined;
      state.lastStoreError = undefined;
      if (inserted) {
        stream.broadcast(); // a duplicate changes nothing, so it patches nothing
        notify?.(); // OS notification path — must fire even when no web client is connected
      }
    } catch (err) {
      state.storeFailedAt = Date.now();
      state.lastStoreError = err instanceof Error ? err.message : String(err);
      // Reads can still work while a write fails, so the rebuild usually succeeds and flips
      // coverage to degraded for connected clients — the outage must not look like calm.
      stream.broadcast();
      return c.json({ error: "store unavailable" }, 503); // never silently drop the failure
    }
    return c.json({ ok: true });
  });

  app.post("/api/intents", async (c) => {
    // Thin handler (rules/server.md): parse and validate here, lifecycle decision in
    // core/attention (overlayForIntent), persistence in the store.
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "malformed" }, 400);
    }
    const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
    // report_seen moves the presence cursor (spec: "Closing the report moves the cursor; it
    // never deletes receipts or attention") — no overlay, just app_state + audit.
    if (b["kind"] === "report_seen") {
      const raw = b["cursor"];
      if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return c.json({ error: "malformed" }, 400);
      // Clamped to now: a skewed client clock must never park the cursor in the future and
      // permanently empty every default report.
      const cursor = Math.min(raw, Date.now());
      try {
        state.store.setAppState(LAST_SEEN_KEY, String(cursor));
        state.store.appendIntentAudit({ kind: "report_seen", cursor }, Date.now());
        state.storeFailedAt = undefined;
        state.lastStoreError = undefined;
      } catch (err) {
        state.storeFailedAt = Date.now();
        state.lastStoreError = err instanceof Error ? err.message : String(err);
        return c.json({ error: "store unavailable" }, 503);
      }
      return c.json({ ok: true, cursor });
    }
    // receipt_mark_reviewed flips a persisted flag on a stable receipt id — the receipt and its
    // evidence are immutable (spec/roadmap M5); re-marking is idempotent (a Set add).
    if (b["kind"] === "receipt_mark_reviewed") {
      const id = b["id"];
      if (typeof id !== "string" || id === "") return c.json({ error: "malformed" }, 400);
      try {
        const reviewed = readReviewedReceipts(state.store);
        if (!reviewed.has(id)) {
          reviewed.add(id);
          state.store.setAppState(REVIEWED_RECEIPTS_KEY, JSON.stringify([...reviewed].sort()));
        }
        state.store.appendIntentAudit({ kind: "receipt_mark_reviewed", id }, Date.now());
        state.storeFailedAt = undefined;
        state.lastStoreError = undefined;
      } catch (err) {
        state.storeFailedAt = Date.now();
        state.lastStoreError = err instanceof Error ? err.message : String(err);
        return c.json({ error: "store unavailable" }, 503);
      }
      stream.broadcast(); // the reviewed flag rides recentReceipts on the next patch
      return c.json({ ok: true, id });
    }
    const mapped =
      typeof b["kind"] === "string"
        ? overlayForIntent(
            {
              kind: b["kind"],
              ...(typeof b["id"] === "string" ? { id: b["id"] } : {}),
              ...(typeof b["until"] === "number" ? { until: b["until"] } : {}),
            },
            Date.now(),
          )
        : null;
    // Remaining non-attention intents (pairing_start/stop) land with M6.
    if (!mapped) return c.json({ error: "unsupported intent" }, 400);
    // Audit the *validated* intent, never the raw body — an unbounded payload must not land in
    // the store, and listIntentAudit's type must match what the row actually holds.
    const intent: UserIntent =
      mapped.overlay.status === "snoozed"
        ? { kind: "attention_snooze", id: mapped.id, until: mapped.overlay.snoozedUntil! }
        : {
            kind: mapped.overlay.status === "resolved" ? "attention_resolve" : "attention_ack",
            id: mapped.id,
          };
    try {
      // Upsert = idempotent: clicking twice writes the same overlay, never a second effect.
      state.store.setAttentionOverlay(mapped.id, mapped.overlay);
      state.store.appendIntentAudit(intent, Date.now());
      state.storeFailedAt = undefined;
      state.lastStoreError = undefined;
    } catch (err) {
      state.storeFailedAt = Date.now();
      state.lastStoreError = err instanceof Error ? err.message : String(err);
      return c.json({ error: "store unavailable" }, 503);
    }
    stream.broadcast(); // connected clients see the item leave/park immediately
    return c.json({ ok: true, id: mapped.id, status: mapped.overlay.status });
  });

  app.get("/api/report", (c) => {
    // Thin handler (rules/server.md): window resolution here, every section decision in
    // core/reports. `?from=` is the user-chosen cursor; default is the presence cursor.
    const raw = c.req.query("from");
    const override = raw === undefined ? undefined : Number(raw);
    if (override !== undefined && !Number.isFinite(override)) return c.json({ error: "malformed" }, 400);
    const now = Date.now();
    try {
      const events = state.store.listEvents(); // one query for the whole window, no N+1
      const stored = Number(state.store.getAppState(LAST_SEEN_KEY));
      const from = override ?? (Number.isFinite(stored) ? stored : 0);
      const report = buildShiftReport({
        events,
        receipts: deriveReceipts(events),
        attention: deriveAttention(events, now, state.store.getAttentionOverlays()),
        from,
        to: now,
      });
      // NB: a successful read never clears storeFailedAt — a recent write failure stays degraded
      // until a write lands (same stance as /api/health).
      return c.json(report);
    } catch (err) {
      state.storeFailedAt = Date.now();
      state.lastStoreError = err instanceof Error ? err.message : String(err);
      return c.json({ error: "store unavailable" }, 503);
    }
  });

  app.get("/api/health", (c) => {
    try {
      const kinds = state.store.countEventsByKind(); // one query, no N+1 (rules/server.md)
      const eventsStored = Object.values(kinds).reduce((sum, n) => sum + n, 0);
      if (state.storeFailedAt === undefined) {
        return c.json({ ok: true, startedAt: state.startedAt, eventsStored, kinds });
      }
      // Reads can succeed while a recent write failed (e.g. a transient busy lock) — still degraded.
      return c.json({
        ok: false,
        degraded: true,
        startedAt: state.startedAt,
        eventsStored,
        kinds,
        storeFailedAt: state.storeFailedAt,
        error: state.lastStoreError,
        guidance: REPAIR_GUIDANCE,
      });
    } catch (err) {
      state.storeFailedAt = Date.now();
      state.lastStoreError = err instanceof Error ? err.message : String(err);
      return c.json({
        ok: false,
        degraded: true,
        startedAt: state.startedAt,
        storeFailedAt: state.storeFailedAt,
        error: state.lastStoreError,
        guidance: REPAIR_GUIDANCE,
      });
    }
  });

  app.route("/", stream.routes);

  // Last: serveStatic skips a request another route already answered, and a missing file falls
  // through to Hono's own 404. Only mounted when the build exists, so an unbuilt checkout keeps
  // behaving exactly as before.
  if (webBuilt()) app.use("*", serveStatic({ root: webRoot() }));

  return app;
};
