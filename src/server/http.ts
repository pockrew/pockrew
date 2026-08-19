import { Hono } from "hono";

import { fromHookPost } from "#adapters/claude/mapper.js";
import type { AgentEvent } from "#contracts/events.js";
import { normalize } from "#core/normalize.js";

export type ServerState = {
  token: string;
  port: number;
  /* ponytail: in-memory ring buffer until the SQLite store lands in M2. */
  events: AgentEvent[];
  startedAt: number;
};

const RING_MAX = 5000;

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
    if (event && !state.events.some((e) => e.dedupeKey === event.dedupeKey)) {
      state.events.push(event);
      if (state.events.length > RING_MAX) state.events.splice(0, state.events.length - RING_MAX);
    }
    return c.json({ ok: true });
  });

  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      startedAt: state.startedAt,
      eventsSeen: state.events.length,
      kinds: state.events.reduce<Record<string, number>>((acc, e) => {
        acc[e.kind] = (acc[e.kind] ?? 0) + 1;
        return acc;
      }, {}),
    }),
  );

  return app;
};
