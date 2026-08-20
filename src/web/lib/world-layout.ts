import type { ProjectView, WorldState } from "#contracts/world.js";

import { STATION_SIZE, STATIONS } from "./world-meta";

/**
 * Spatial placement of districts on one large world plane: the camera pans across it, so a base
 * lives at a coordinate instead of at a position in a vertical list.
 *
 * Derived on every render from the project order and never persisted (docs/spec.md "Persistence":
 * "the world rebuilds from the DB plus live sources; coordinates are not persisted").
 */

/** Breathing room around the station grid. */
const STAGE_MARGIN = 8;

/** The station grid, measured from the stations themselves — CSS reads these back as variables. */
export const STAGE_SIZE = {
  width: Math.max(...STATIONS.map((s) => s.x + STATION_SIZE.width)) + STAGE_MARGIN,
  height: Math.max(...STATIONS.map((s) => s.y + STATION_SIZE.height)) + STAGE_MARGIN,
};

/** Card padding plus the nameplate header row. */
const DISTRICT_CHROME = { width: 24, height: 80 };

/** Footprint of one district card: the stage plus its chrome. */
export const DISTRICT_SIZE = {
  width: STAGE_SIZE.width + DISTRICT_CHROME.width,
  height: STAGE_SIZE.height + DISTRICT_CHROME.height,
};

/** Empty plane between neighbouring districts — the travel you feel while dragging. */
const GAP = 128;
const CELL_W = DISTRICT_SIZE.width + GAP;
const CELL_H = DISTRICT_SIZE.height + GAP;

export type DistrictPlacement = { projectId: string; x: number; y: number };

export type WorldPlane = { width: number; height: number; placements: DistrictPlacement[] };

/**
 * Staggered grid: rows alternate by half a cell so the world reads as a settlement rather than a
 * spreadsheet. Square-ish so panning stays two-dimensional however many projects exist.
 */
export const layoutDistricts = (projects: readonly Pick<ProjectView, "id">[]): WorldPlane => {
  const cols = Math.max(1, Math.ceil(Math.sqrt(projects.length)));
  const rows = Math.max(1, Math.ceil(projects.length / cols));
  const placements = projects.map((project, index) => {
    const row = Math.floor(index / cols);
    return {
      projectId: project.id,
      x: GAP + (index % cols) * CELL_W + (row % 2 === 1 ? CELL_W / 2 : 0),
      y: GAP + row * CELL_H,
    };
  });
  return {
    width: GAP + cols * CELL_W + (rows > 1 ? CELL_W / 2 : 0),
    height: GAP + rows * CELL_H,
    placements,
  };
};

/** How recent an activity or delivery keeps a district on the plane. */
export const RECENT_WINDOW_MS = 30 * 60_000;

/**
 * Districts worth travelling to: something is alive there (an actor that has not ended, an open
 * attention item) or something happened there recently. A project whose whole crew has gone home
 * leaves the plane — it stays in the data and in the warehouse, it just stops taking up a base.
 * `world.generatedAt` is the clock; nothing here reads the wall time.
 */
export const nearProjectIds = (world: WorldState): ReadonlySet<string> => {
  const since = world.generatedAt - RECENT_WINDOW_MS;
  const near = new Set<string>();
  for (const actor of world.actors) if (actor.state !== "ended") near.add(actor.projectId);
  for (const item of world.attention)
    if (item.status === "open" || item.status === "acknowledged") near.add(item.projectId);
  for (const activity of world.activities)
    if ((activity.endedAt ?? activity.startedAt) >= since) near.add(activity.projectId);
  for (const receipt of world.recentReceipts) if (receipt.occurredAt >= since) near.add(receipt.projectId);
  return near;
};

export type Camera = { x: number; y: number };

/** Keeps the camera inside the plane; a plane smaller than the viewport pins to the origin. */
export const clampCamera = (x: number, y: number, plane: WorldPlane, viewW: number, viewH: number): Camera => ({
  x: Math.max(0, Math.min(x, plane.width - viewW)),
  y: Math.max(0, Math.min(y, plane.height - viewH)),
});

/** Camera that puts one district in the middle of the viewport — "entering the base". */
export const focusCamera = (placement: DistrictPlacement, plane: WorldPlane, viewW: number, viewH: number): Camera =>
  clampCamera(
    placement.x + DISTRICT_SIZE.width / 2 - viewW / 2,
    placement.y + DISTRICT_SIZE.height / 2 - viewH / 2,
    plane,
    viewW,
    viewH,
  );
