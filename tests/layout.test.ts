import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, expect, test, vi } from "vitest";

import type { ActivityView, ActorView, ProjectView, WorldState } from "#contracts/world.js";
import { openStore, type Store } from "#core/store/store.js";
import { attachLayout } from "#server/stream.js";

const dir = mkdtempSync(join(tmpdir(), "pockrew-layout-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const project = (id: string, actorIds: string[]): ProjectView => ({
  id,
  displayName: id,
  actorIds,
  openAttentionCount: 0,
  verifiedReceiptCount: 0,
  updatedAt: 0,
});

const actor = (id: string, projectId: string, station: ActorView["station"]): ActorView => ({
  id,
  projectId,
  sessionId: id,
  source: "claude",
  displayName: id,
  state: "working",
  stateConfidence: "observed",
  station,
  attentionIds: [],
  startedAt: 0,
  updatedAt: 0,
});

const activity = (
  id: string,
  actorId: string,
  projectId: string,
  category: ActivityView["category"],
): ActivityView => ({
  id,
  actorId,
  projectId,
  category,
  status: "completed",
  confidence: "observed",
  startedAt: 0,
  endedAt: 100,
});

const world = (projects: ProjectView[], actors: ActorView[], activities: ActivityView[] = []): WorldState => ({
  generatedAt: 0,
  coverage: [],
  projects,
  actors,
  activities,
  attention: [],
  recentReceipts: [],
  milestones: [],
});

test("attachLayout: stations and towns persist across rebuilds, built ones never move", () => {
  const store = openStore(join(dir, "layout.sqlite"));

  // Rebuild 1: proj-1's only actor is at the library. HQ is always implied.
  const w1 = world([project("proj-1", ["a1"])], [actor("a1", "proj-1", "library")]);
  const r1 = attachLayout(w1, store, 1_000);
  const p1 = r1.projects.find((p) => p.id === "proj-1")!;
  expect(p1.stationCells?.map((c) => c.station).sort()).toEqual(["hq", "library"]);
  const hqCell = p1.stationCells!.find((c) => c.station === "hq")!;
  const libraryCell = p1.stationCells!.find((c) => c.station === "library")!;
  expect(hqCell).toEqual({ station: "hq", x: 0, y: 0 });
  // The very first project ever seen is pinned to the center of the world grid.
  expect(p1.worldCell).toEqual({ x: 0, y: 0 });
  expect(store.getTownLayouts(["proj-1"]).get("proj-1")).toHaveLength(2);
  expect(store.getWorldLayout()).toHaveLength(1);

  // Rebuild 2: nothing changed. Two rebuilds of the same DB must be byte-identical.
  const r2 = attachLayout(w1, store, 2_000);
  const p2 = r2.projects.find((p) => p.id === "proj-1")!;
  expect(p2.stationCells).toEqual(p1.stationCells);
  expect(p2.worldCell).toEqual(p1.worldCell);
  expect(store.getTownLayouts(["proj-1"]).get("proj-1")).toHaveLength(2); // INSERT OR IGNORE: no duplicate rows

  // Rebuild 3: the actor has moved off the library entirely — it now stands at the workshop.
  // Built stations are permanent: library must still be there, unmoved, alongside the new one.
  const w3 = world([project("proj-1", ["a1"])], [actor("a1", "proj-1", "workshop")]);
  const r3 = attachLayout(w3, store, 3_000);
  const p3 = r3.projects.find((p) => p.id === "proj-1")!;
  expect(p3.stationCells?.map((c) => c.station).sort()).toEqual(["hq", "library", "workshop"]);
  expect(p3.stationCells?.find((c) => c.station === "hq")).toEqual(hqCell);
  expect(p3.stationCells?.find((c) => c.station === "library")).toEqual(libraryCell); // unmoved
  const workshopCell = p3.stationCells!.find((c) => c.station === "workshop")!;
  expect(workshopCell).not.toEqual(libraryCell);
  expect(store.getTownLayouts(["proj-1"]).get("proj-1")).toHaveLength(3);

  // Rebuild 4: a second project shows up. It claims a seeded ring cell around the first town;
  // proj-1's own world cell never moves.
  const w4 = world(
    [project("proj-1", ["a1"]), project("proj-2", ["a2"])],
    [actor("a1", "proj-1", "workshop"), actor("a2", "proj-2", "hq")],
  );
  const r4 = attachLayout(w4, store, 4_000);
  const proj1Again = r4.projects.find((p) => p.id === "proj-1")!;
  const proj2 = r4.projects.find((p) => p.id === "proj-2")!;
  expect(proj1Again.worldCell).toEqual({ x: 0, y: 0 }); // unmoved
  expect(proj2.worldCell).toBeDefined();
  expect(proj2.worldCell).not.toEqual({ x: 0, y: 0 }); // center was already taken
  expect(store.getWorldLayout()).toHaveLength(2);

  store.close();
});

test("attachLayout: a completed activity's station persists even with no actor standing there", () => {
  const store = openStore(join(dir, "activity-only.sqlite"));

  // The actor itself is idle in the lounge — stationFor only reports a category-derived station
  // while an activity is still running. Only the (already completed) activity record proves a
  // "code" activity ran here at all; without unioning it, "workshop" would never get persisted
  // unless a client happened to be connected while that activity was still running.
  const w = world(
    [project("proj-1", ["a1"])],
    [actor("a1", "proj-1", "lounge")],
    [activity("act-1", "a1", "proj-1", "code")],
  );
  const r = attachLayout(w, store, 1_000);
  const p = r.projects.find((p) => p.id === "proj-1")!;
  expect(p.stationCells?.map((c) => c.station).sort()).toEqual(["hq", "lounge", "workshop"]);

  store.close();
});

test("attachLayout: a failed layout write never throws into the rebuild, and never claims an unsaved cell", () => {
  const real = openStore(join(dir, "write-fails.sqlite"));
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const store: Store = {
    ...real,
    placeStations: () => {
      throw new Error("SQLITE_BUSY");
    },
    placeWorldCells: () => {
      throw new Error("SQLITE_BUSY");
    },
  };

  const w = world([project("proj-1", ["a1"])], [actor("a1", "proj-1", "library")]);
  expect(() => attachLayout(w, store, 1_000)).not.toThrow();
  const result = attachLayout(w, store, 1_000);
  const p = result.projects.find((p) => p.id === "proj-1")!;
  // Nothing durable exists yet, so the new (unsaved) library/HQ cells and world cell fall back
  // to the read-only (empty) layout rather than being presented as if they were stable.
  expect(p.stationCells).toEqual([]);
  expect(p.worldCell).toBeUndefined();
  expect(real.getTownLayouts(["proj-1"]).has("proj-1")).toBe(false);
  expect(real.getWorldLayout()).toEqual([]);
  expect(spy).toHaveBeenCalled();

  spy.mockRestore();
  real.close();
});
