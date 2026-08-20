// SSE world stream. EventSource cannot set request headers and a token in a URL lands in access
// logs, so this stream authenticates with a single-use ticket instead (spec "Security and
// reliability"): POST the real token to /api/stream-ticket, put the ticket in the stream URL.
import { randomBytes } from "node:crypto";

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { AgentEvent } from "#contracts/events.js";
import type { StreamMessage, WorldPatchOp } from "#contracts/stream.js";
import type { WorldState } from "#contracts/world.js";
import type { Store } from "#core/store/store.js";
import { assembleWorld } from "#core/world.js";

/** Spec: a ticket is valid for 30 seconds and for one connection. */
const TICKET_TTL_MS = 30_000;

// How often a connected client is re-diffed so time-derived state (idle, ended, an activity past
// its window) actually arrives. Our own number: well inside the 750 ms-per-event budget's spirit
// while the shortest reducer hold is 8s, and cheap because an unchanged world sends nothing.
const TICK_MS = 2_000;

export type StreamDeps = {
  store: Store;
  /** Coverage rows from real signals, computed by the caller over the same event window. */
  coverage: (events: AgentEvent[]) => WorldState["coverage"];
};

export type StreamHub = {
  /** POST /api/stream-ticket and GET /api/stream, mounted by http.ts. */
  routes: Hono;
  /** Rebuild the world and push one patch carrying the top-level keys that changed. */
  broadcast: () => void;
};

// The correlated key/value union cannot be built generically without a cast; the key comes
// straight off WorldState, so the pair is always consistent.
const patchOp = <K extends keyof WorldState>(key: K, world: WorldState): WorldPatchOp =>
  ({ key, value: world[key] }) as WorldPatchOp;

/** Replace-by-key patches (spec transport): a key ships only when its JSON actually changed. */
const diffOps = (before: WorldState | undefined, after: WorldState): WorldPatchOp[] =>
  (Object.keys(after) as Array<keyof WorldState>)
    .filter((key) => before === undefined || JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => patchOp(key, after));

export const createStreamHub = (deps: StreamDeps): StreamHub => {
  const tickets = new Map<string, number>(); // ticket → expiresAt
  const clients = new Set<(msg: StreamMessage) => void>();
  // ponytail: global diff baseline, per-client baselines when patches get finer-grained.
  let lastBroadcast: WorldState | undefined;
  let tick: ReturnType<typeof setInterval> | undefined;

  const issueTicket = (now: number): string => {
    for (const [t, expiresAt] of tickets) if (expiresAt <= now) tickets.delete(t); // no unbounded growth
    const ticket = randomBytes(32).toString("hex");
    tickets.set(ticket, now + TICKET_TTL_MS);
    return ticket;
  };

  /** Single use: any known ticket is consumed here, valid or expired, and never accepted twice. */
  const consumeTicket = (ticket: string | undefined, now: number): boolean => {
    if (ticket === undefined) return false;
    const expiresAt = tickets.get(ticket);
    if (expiresAt === undefined) return false;
    tickets.delete(ticket);
    return expiresAt > now;
  };

  // One query for the whole event window, then a pure assembly — never a query per actor
  // (rules/server.md). ponytail: full rebuild per event over the whole table; switch to
  // listEvents({ sinceOccurredAt }) plus persisted milestone counters when the 750 ms p95 budget
  // bites or retention cleanup lands (spec: lifetime counters survive event cleanup).
  const currentWorld = (): WorldState => {
    const events = deps.store.listEvents();
    return assembleWorld(events, Date.now(), deps.coverage(events));
  };

  const routes = new Hono();

  routes.post("/api/stream-ticket", (c) => c.json({ ticket: issueTicket(Date.now()) }));

  routes.get("/api/stream", (c) => {
    if (!consumeTicket(c.req.query("ticket"), Date.now())) return c.json({ error: "unauthorized" }, 401);
    return streamSSE(c, async (stream) => {
      const send = (msg: StreamMessage): void => {
        // Default (unnamed) SSE frames, so a plain `EventSource.onmessage` receives every message
        // and discriminates on `msg.type` — a named event would need one listener per type.
        // A dead connection must drop itself: onAbort does not fire for every failure mode.
        void stream.writeSSE({ data: JSON.stringify(msg) }).catch(() => drop(send));
      };
      const drop = (client: typeof send): void => {
        clients.delete(client);
        if (clients.size === 0) stopTicking();
      };
      // A full snapshot before any patch, so the client never merges across a gap (spec). It also
      // becomes the baseline every later patch diffs against, which keeps patches minimal; the
      // cost is that a client connected earlier stays behind on purely time-derived decay until
      // the next real event touches that key.
      const snapshot = currentWorld();
      lastBroadcast = snapshot;
      send({ type: "snapshot", world: snapshot });
      clients.add(send);
      startTicking();
      await new Promise<void>((resolve) => stream.onAbort(resolve));
      drop(send);
    });
  });

  const broadcast = (): void => {
    if (clients.size === 0) return; // nobody connected: skip the rebuild entirely
    let world: WorldState;
    try {
      world = currentWorld();
    } catch (err) {
      // /api/health already reports a failing store; a broken rebuild must not break ingestion.
      console.error(`stream: world rebuild failed — ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const ops = diffOps(lastBroadcast, world);
    lastBroadcast = world;
    // generatedAt alone is just the rebuild clock: an idle world sends nothing.
    if (ops.length === 0 || (ops.length === 1 && ops[0]?.key === "generatedAt")) return;
    for (const send of clients) send({ type: "patch", ops });
  };

  // Actor state also decays with time alone — an activity past its window, the idle, completed and
  // ended holds in reduceActors. Without a tick a character would sit "working" forever on a client
  // until the next event arrived (spec: "Actor liveness cleanup prevents a character stuck working
  // forever"). Only runs while someone is connected.
  const startTicking = (): void => {
    if (tick !== undefined) return;
    tick = setInterval(broadcast, TICK_MS);
    tick.unref(); // never keeps the daemon alive on its own
  };

  const stopTicking = (): void => {
    if (tick !== undefined) clearInterval(tick);
    tick = undefined;
  };

  return { routes, broadcast };
};
