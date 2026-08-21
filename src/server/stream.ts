// SSE world stream. EventSource cannot set request headers and a token in a URL lands in access
// logs, so this stream authenticates with a single-use ticket instead (spec "Security and
// reliability"): POST the real token to /api/stream-ticket, put the ticket in the stream URL.
import { randomBytes } from "node:crypto";

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { AgentEvent } from "#contracts/events.js";
import type { StreamMessage, WorldPatchOp } from "#contracts/stream.js";
import type { Station, StationCell, WorldState } from "#contracts/world.js";
import type { Store } from "#core/store/store.js";
import { assignCells, assignWorldCells } from "#core/town.js";
import { assembleWorld, STATION_BY_CATEGORY } from "#core/world.js";

/** Spec: a ticket is valid for 30 seconds and for one connection. */
const TICKET_TTL_MS = 30_000;

/** app_state key for the presence cursor (spec "Shift Report"): the last moment a web client was
 *  actually watching. Stamped while connected, frozen when the last client leaves — the shift
 *  report window starts here. Moved explicitly by the `report_seen` intent. */
export const LAST_SEEN_KEY = "lastSeenAt";

/** app_state key holding the JSON string[] of receipt ids the user marked reviewed.
 *  ponytail: one JSON blob read-modify-written per intent — move to a table when retention
 *  cleanup lands or the list measurably grows. */
export const REVIEWED_RECEIPTS_KEY = "reviewedReceipts";

/** Malformed/missing state degrades to "nothing reviewed" — never a crash on a corrupt row. */
export const readReviewedReceipts = (store: Store): Set<string> => {
  try {
    const raw = store.getAppState(REVIEWED_RECEIPTS_KEY);
    const parsed: unknown = raw === undefined ? [] : JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
};

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

/**
 * HQ, plus every station a currently-known actor stands at OR a recorded activity implies — the
 * set that can *need* a new cell this rebuild. `world.activities` matters on its own: an actor's
 * own `.station` only reflects a category while that activity is still running (stationFor), so
 * an activity that has since completed and let its actor decay to idle/lounge would otherwise
 * never get a station persisted unless a client happened to be connected while it ran — exactly
 * the gap persistence exists to close. Already-persisted stations are never filtered by this: see
 * attachLayout.
 */
const activeStationsFor = (world: WorldState, projectId: string): Station[] => {
  const stations = new Set<Station>(["hq"]);
  for (const actor of world.actors) if (actor.projectId === projectId) stations.add(actor.station);
  for (const activity of world.activities) {
    if (activity.projectId === projectId) stations.add(STATION_BY_CATEGORY[activity.category]);
  }
  return [...stations];
};

/** Runs a store write; on failure (e.g. SQLITE_BUSY) logs and returns false instead of throwing
 *  into the stream — a snapshot/broadcast must never die because a layout INSERT couldn't land. */
const tryPersist = (write: () => void, what: string): boolean => {
  try {
    write();
    return true;
  } catch (err) {
    console.error(`stream: persisting new ${what} failed — ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
};

/**
 * Attaches the persisted town/world layout to a freshly assembled world (IO lives here, not in
 * core/world.ts — that module stays pure). Built stations are permanent (spec "Persistence"):
 * `stationCells` always carries every row town_layout has ever recorded for a project, never
 * filtered by current activity — only *which new stations to assign* this rebuild comes from
 * what is active right now. One batch query for every project's layout, one for the whole
 * world_layout table, never one query per project (rules/server.md: no N+1). A failed write falls
 * back to the read-only (already-durable) layout rather than claiming an unsaved cell is stable.
 */
export const attachLayout = (world: WorldState, store: Store, now: number): WorldState => {
  const projectIds = world.projects.map((p) => p.id);
  const townLayouts = store.getTownLayouts(projectIds);
  const worldLayout = store.getWorldLayout();

  const newStationRows: Array<{ projectId: string; station: Station; x: number; y: number; placedAt: number }> = [];
  const createdByProject = new Map<string, StationCell[]>();
  for (const project of world.projects) {
    const persisted = townLayouts.get(project.id) ?? [];
    const created = assignCells(persisted, activeStationsFor(world, project.id), project.id);
    createdByProject.set(project.id, created);
    for (const cell of created) newStationRows.push({ projectId: project.id, ...cell, placedAt: now });
  }
  const stationsSaved =
    newStationRows.length === 0 || tryPersist(() => store.placeStations(newStationRows), "stations");

  const newWorldCells = assignWorldCells(worldLayout, projectIds);
  const worldSaved =
    newWorldCells.length === 0 ||
    tryPersist(() => store.placeWorldCells(newWorldCells.map((c) => ({ ...c, placedAt: now }))), "world cells");
  const worldByProject = new Map([...worldLayout, ...(worldSaved ? newWorldCells : [])].map((c) => [c.projectId, c]));

  return {
    ...world,
    projects: world.projects.map((project) => {
      const persisted = townLayouts.get(project.id) ?? [];
      const created = stationsSaved ? (createdByProject.get(project.id) ?? []) : [];
      const cell = worldByProject.get(project.id);
      return {
        ...project,
        stationCells: [...persisted, ...created],
        ...(cell ? { worldCell: { x: cell.x, y: cell.y } } : {}),
      };
    }),
  };
};

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
    const now = Date.now();
    const events = deps.store.listEvents();
    const world = assembleWorld(
      events,
      now,
      deps.coverage(events),
      deps.store.getAttentionOverlays(),
      readReviewedReceipts(deps.store),
    );
    return attachLayout(world, deps.store, now);
  };

  /** Presence: the cursor moves ONLY when a client disconnects (they watched until then) or via
   *  the report_seen intent — never on connect (that would wipe the window before the report is
   *  read) and never on a tick (EventSource stays open in a hidden tab, which would make the
   *  "back after 10 minutes" report permanently empty). A failed write only widens the next
   *  report window — over-reporting, never a lie. */
  const stampPresence = (now: number): void => {
    tryPersist(() => deps.store.setAppState(LAST_SEEN_KEY, String(now)), "presence cursor");
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
        if (clients.delete(client)) stampPresence(Date.now()); // guarded: drop can fire twice per client
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
