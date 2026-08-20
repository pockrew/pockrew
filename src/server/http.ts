import { Hono } from "hono";

import { fromHookPost } from "#adapters/claude/mapper.js";
import { normalize } from "#core/normalize.js";
import type { Store } from "#core/store/store.js";

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

export const createApp = (state: ServerState): Hono => {
  const app = new Hono();

  app.use("*", async (c, next) => {
    // Every endpoint requires the token (spec: security). Origin allowlist: hook
    // shim sends no Origin; a browser Origin must be this local app.
    const token = c.req.header("x-pockrew-token");
    if (token !== state.token) return c.json({ error: "unauthorized" }, 401);
    const origin = c.req.header("origin");
    if (origin !== undefined) {
      const allowed = [`http://127.0.0.1:${state.port}`, `http://localhost:${state.port}`];
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
      state.store.insertEvent(event); // idempotent on dedupeKey
      state.storeFailedAt = undefined;
      state.lastStoreError = undefined;
    } catch (err) {
      state.storeFailedAt = Date.now();
      state.lastStoreError = err instanceof Error ? err.message : String(err);
      return c.json({ error: "store unavailable" }, 503); // never silently drop the failure
    }
    return c.json({ ok: true });
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

  return app;
};
