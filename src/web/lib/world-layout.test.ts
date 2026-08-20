import { expect, test } from "vitest";

import type { WorldState } from "#contracts/world.js";

import { mockWorld } from "@/mock/world";

import {
  clampCamera,
  DISTRICT_SIZE,
  focusCamera,
  layoutDistricts,
  nearProjectIds,
  RECENT_WINDOW_MS,
} from "./world-layout";

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
  expect(cam.x + 400).toBeCloseTo(target.x + DISTRICT_SIZE.width / 2);
  expect(cam.y + 300).toBeCloseTo(target.y + DISTRICT_SIZE.height / 2);
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
