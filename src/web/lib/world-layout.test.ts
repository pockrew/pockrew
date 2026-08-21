import { expect, test } from "vitest";

import type { WorldState } from "#contracts/world.js";

import { mockWorld } from "@/mock/world";

import { cellKey, CENTER, ringOf } from "./grid";
import {
  clampCamera,
  DISTRICT_SIZE,
  districtSize,
  focusCamera,
  layoutDistricts,
  mostRelevantProjectId,
  nearProjectIds,
  widestTown,
  worldCells,
} from "./world-layout";
import { RECENT_WINDOW_MS } from "./world-meta";

const projects = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));

test("every district gets its own spot and the plane contains all of them", () => {
  const plane = layoutDistricts(projects(7));
  expect(plane.placements).toHaveLength(7);
  const spots = new Set(plane.placements.map((p) => `${p.x},${p.y}`));
  expect(spots.size).toBe(7);
  for (const p of plane.placements) {
    expect(p.x + DISTRICT_SIZE.width).toBeLessThanOrEqual(plane.width);
    expect(p.y + DISTRICT_SIZE.height).toBeLessThanOrEqual(plane.height);
  }
});

test("districts never overlap", () => {
  const { placements } = layoutDistricts(projects(12));
  for (const a of placements)
    for (const b of placements) {
      if (a === b) continue;
      const apart = Math.abs(a.x - b.x) >= DISTRICT_SIZE.width || Math.abs(a.y - b.y) >= DISTRICT_SIZE.height;
      expect(apart, `${a.projectId} overlaps ${b.projectId}`).toBe(true);
    }
});

test("layout is deterministic and survives an empty world", () => {
  expect(layoutDistricts(projects(5))).toEqual(layoutDistricts(projects(5)));
  const empty = layoutDistricts([]);
  expect(empty.placements).toEqual([]);
  expect(empty.width).toBeGreaterThan(0);
});

test("towns take the world cell the server persisted for them", () => {
  const cells = worldCells([
    { id: "a", worldCell: { x: 2, y: -1 } },
    { id: "b", worldCell: { x: 0, y: 0 } },
  ]);
  expect(cells.get("a")).toEqual({ x: 2, y: -1 });
  expect(cells.get("b")).toEqual(CENTER);
});

test("without persisted cells the first town anchors the center and the rest ring around it", () => {
  const cells = worldCells(projects(5));
  expect(cells.get("p0")).toEqual(CENTER);
  for (const id of ["p1", "p2", "p3", "p4"]) expect(ringOf(cells.get(id)!)).toBe(1);
  expect(new Set([...cells.values()].map(cellKey)).size).toBe(5);
});

test("a seeded town never lands on a persisted neighbour's cell, and leaves the center alone", () => {
  const cells = worldCells([{ id: "kept", worldCell: { x: 0, y: 0 } }, ...projects(3)]);
  expect(cells.get("kept")).toEqual(CENTER);
  // The center is taken, so nobody else may claim it — not even the alphabetically first newcomer.
  for (const id of ["p0", "p1", "p2"]) expect(cells.get(id)).not.toEqual(CENTER);
  expect(new Set([...cells.values()].map(cellKey)).size).toBe(4);
});

test("persisted and seeded towns share one plane without overlapping", () => {
  const plane = layoutDistricts([{ id: "far", worldCell: { x: 3, y: 2 } }, ...projects(4)]);
  expect(plane.placements).toHaveLength(5);
  for (const p of plane.placements) {
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x + plane.size.width).toBeLessThanOrEqual(plane.width);
    expect(p.y + plane.size.height).toBeLessThanOrEqual(plane.height);
  }
  const spots = new Set(plane.placements.map((p) => `${p.x},${p.y}`));
  expect(spots.size).toBe(5);
});

test("the plane paces itself by the widest town on it", () => {
  expect(widestTown([])).toBe(3);
  expect(widestTown([3, 5, 3])).toBe(5);
  expect(widestTown([1])).toBe(3);
  const wide = layoutDistricts(projects(4), 5);
  expect(wide.size).toEqual(districtSize(5));
  const normal = layoutDistricts(projects(4));
  expect(wide.width).toBeGreaterThan(normal.width);
  // Same cells, bigger pitch: a 5x5 town still cannot reach its neighbour.
  for (const a of wide.placements)
    for (const b of wide.placements) {
      if (a === b) continue;
      const apart = Math.abs(a.x - b.x) >= wide.size.width || Math.abs(a.y - b.y) >= wide.size.height;
      expect(apart, `${a.projectId} overlaps ${b.projectId}`).toBe(true);
    }
});

test("camera stays inside the plane and pins to the origin when the plane fits", () => {
  const plane = layoutDistricts(projects(4));
  expect(clampCamera(-500, -500, plane, 800, 600)).toEqual({ x: 0, y: 0 });
  expect(clampCamera(99_999, 99_999, plane, 800, 600)).toEqual({
    x: plane.width - 800,
    y: plane.height - 600,
  });
  const tiny = layoutDistricts(projects(1));
  expect(clampCamera(120, 120, tiny, 99_999, 99_999)).toEqual({ x: 0, y: 0 });
});

test("focusing a district centers it in the viewport", () => {
  const plane = layoutDistricts(projects(9));
  const target = plane.placements[4]!;
  const cam = focusCamera(target, plane, 800, 600);
  expect(cam.x + 400).toBeCloseTo(target.x + plane.size.width / 2);
  expect(cam.y + 300).toBeCloseTo(target.y + plane.size.height / 2);
});

/** Same world, but every crew has gone home and nothing happened recently. */
const stale: WorldState = {
  ...mockWorld,
  actors: mockWorld.actors.map((a) => ({ ...a, state: "ended" as const, attentionIds: [] })),
  activities: [],
  attention: [],
  recentReceipts: [],
};

test("a district stays on the plane while anything there is alive", () => {
  expect(nearProjectIds(mockWorld)).toEqual(new Set(mockWorld.projects.map((p) => p.id)));
});

test("a district whose crew has all ended leaves the plane", () => {
  expect(nearProjectIds(stale).size).toBe(0);
});

test("a recent delivery or an open attention item keeps a fully-ended district", () => {
  const receipt = mockWorld.recentReceipts[0]!;
  const recent = { ...receipt, occurredAt: mockWorld.generatedAt - 60_000 };
  expect(nearProjectIds({ ...stale, recentReceipts: [recent] })).toEqual(new Set([receipt.projectId]));

  const old = { ...receipt, occurredAt: mockWorld.generatedAt - RECENT_WINDOW_MS - 1 };
  expect(nearProjectIds({ ...stale, recentReceipts: [old] }).size).toBe(0);

  const item = mockWorld.attention[0]!;
  expect(nearProjectIds({ ...stale, attention: [item] })).toEqual(new Set([item.projectId]));
});

test("the opening camera goes to whoever wants the user, then to the busiest crew", () => {
  const ids = mockWorld.projects.map((p) => p.id);
  const waiting = mockWorld.actors.find((a) => a.state === "waiting_user")!;
  expect(mostRelevantProjectId(mockWorld, ids)).toBe(waiting.projectId);

  // Nobody waiting: the most recently updated working actor wins.
  const calm: WorldState = {
    ...mockWorld,
    actors: mockWorld.actors.map((a) => (a.state === "waiting_user" ? { ...a, state: "idle" as const } : a)),
  };
  const working = calm.actors.find((a) => a.state === "working")!;
  expect(mostRelevantProjectId(calm, ids)).toBe(working.projectId);

  // Only districts still on the plane are candidates.
  expect(mostRelevantProjectId(mockWorld, [ids[1]!])).toBe(ids[1]);
  expect(mostRelevantProjectId(mockWorld, [])).toBeUndefined();
});
