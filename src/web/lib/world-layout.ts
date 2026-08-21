import type { ProjectView, WorldState } from "#contracts/world.js";

import { isOpenAttention } from "./attention";
import { plateSize } from "./district-layout";
import { hash, placeCells, type Cell } from "./grid";
import { RECENT_WINDOW_MS } from "./world-meta";

/**
 * Spatial placement of towns on one whole-machine plane: the camera pans across it, so a base lives
 * at a coordinate instead of at a position in a vertical list.
 *
 * Same center-out grid as a town's own stations, one level up (lib/grid): cells come from the
 * server's persisted `worldCell` when it has one, and from the same seeded placement it would have
 * used when it does not. The pixel pitch is one district footprint plus a gutter.
 */

/** Cells per side of a normal town — what the plane paces itself by until a town outgrows it. */
const TOWN_SIDE = 3;

/** The stage is the plate a normal district is laid out on; CSS reads these back as variables. */
export const STAGE_SIZE = plateSize(TOWN_SIDE);

/** Card padding plus the nameplate header row. */
const DISTRICT_CHROME = { width: 24, height: 80 };

/** Footprint of one district card: its plate plus the chrome around it. */
export const districtSize = (townSide: number): { width: number; height: number } => {
  const plate = plateSize(townSide);
  return { width: plate.width + DISTRICT_CHROME.width, height: plate.height + DISTRICT_CHROME.height };
};

export const DISTRICT_SIZE = districtSize(TOWN_SIDE);

/** Empty plane between neighbouring districts — the travel you feel while dragging. */
const GAP = 128;

/** Every town shares one plane, so its seed is fixed; only the project id varies (mirrors core/town). */
const WORLD_SEED = (projectId: string): number => hash(projectId);

export type DistrictPlacement = { projectId: string; x: number; y: number };

export type WorldPlane = {
  width: number;
  height: number;
  /** Footprint every district is paced by — the largest town on the plane, so none overlap. */
  size: { width: number; height: number };
  placements: DistrictPlacement[];
};

/**
 * World-grid cell per town: persisted `worldCell` wins, the rest are seeded the way the server would
 * seed them. When nothing is persisted yet the alphabetically first project anchors the center, the
 * way HQ anchors a town (mirrors core/town `assignWorldCells`).
 */
export const worldCells = (projects: readonly Pick<ProjectView, "id" | "worldCell">[]): Map<string, Cell> => {
  const cells = new Map<string, Cell>();
  for (const project of projects) {
    if (project.worldCell) cells.set(project.id, { x: project.worldCell.x, y: project.worldCell.y });
  }
  const missing = projects.filter((project) => !cells.has(project.id)).map((project) => project.id);
  const pinned = cells.size === 0 ? [...missing].sort((a, b) => a.localeCompare(b))[0] : undefined;
  for (const [id, cell] of placeCells([...cells.values()], missing, WORLD_SEED, pinned)) cells.set(id, cell);
  return cells;
};

/**
 * Towns on the world grid, center-out. `townSide` is the widest town currently on the plane: every
 * cell is paced by it, so a town that grew to 5×5 never overlaps its neighbours.
 */
export const layoutDistricts = (
  projects: readonly Pick<ProjectView, "id" | "worldCell">[],
  townSide: number = TOWN_SIDE,
): WorldPlane => {
  const size = districtSize(Math.max(TOWN_SIDE, townSide));
  const pitch = { width: size.width + GAP, height: size.height + GAP };
  const cells = worldCells(projects);
  const placed = projects.map((project) => ({ projectId: project.id, cell: cells.get(project.id)! }));
  if (placed.length === 0) return { width: GAP, height: GAP, size, placements: [] };
  // Cells are signed and the plane is not: shift the whole grid so its top-left corner is the origin.
  const xs = placed.map((p) => p.cell.x);
  const ys = placed.map((p) => p.cell.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    width: GAP + (Math.max(...xs) - minX + 1) * pitch.width,
    height: GAP + (Math.max(...ys) - minY + 1) * pitch.height,
    size,
    placements: placed.map(({ projectId, cell }) => ({
      projectId,
      x: GAP + (cell.x - minX) * pitch.width,
      y: GAP + (cell.y - minY) * pitch.height,
    })),
  };
};

/** Cells per side of the widest town on the plane — what `layoutDistricts` paces every cell by. */
export const widestTown = (sides: Iterable<number>): number => {
  let widest = TOWN_SIDE;
  for (const side of sides) widest = Math.max(widest, side);
  return widest;
};

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
  for (const item of world.attention) if (isOpenAttention(item)) near.add(item.projectId);
  for (const activity of world.activities)
    if ((activity.endedAt ?? activity.startedAt) >= since) near.add(activity.projectId);
  for (const receipt of world.recentReceipts) if (receipt.occurredAt >= since) near.add(receipt.projectId);
  return near;
};

/**
 * Where the camera should start: the district that most wants the user right now — one waiting on
 * them, else the one whose working crew moved last. Used once, on the first snapshot only; later
 * patches never move the camera (docs/spec.md: "never auto-pan away from keyboard focus").
 */
export const mostRelevantProjectId = (world: WorldState, candidates: readonly string[]): string | undefined => {
  const allowed = new Set(candidates);
  const rank = (actor: WorldState["actors"][number]) =>
    actor.state === "waiting_user" ? 0 : actor.state === "working" ? 1 : 2;
  const best = world.actors
    .filter((a) => allowed.has(a.projectId))
    .sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt)[0];
  return best?.projectId ?? candidates[0];
};

export type Camera = { x: number; y: number };

/** One axis of the clamp: inside the plane while it overflows the viewport; a plane smaller than
 *  the viewport centers instead of pinning top-left — a one-town world must fill the screen like a
 *  game map, not sit in a corner with dead space around it. */
const clampAxis = (value: number, span: number, view: number): number =>
  span <= view ? (span - view) / 2 : Math.max(0, Math.min(value, span - view));

export const clampCamera = (x: number, y: number, plane: WorldPlane, viewW: number, viewH: number): Camera => ({
  x: clampAxis(x, plane.width, viewW),
  y: clampAxis(y, plane.height, viewH),
});

/** Camera that puts one district in the middle of the viewport — "entering the base". */
export const focusCamera = (placement: DistrictPlacement, plane: WorldPlane, viewW: number, viewH: number): Camera =>
  clampCamera(
    placement.x + plane.size.width / 2 - viewW / 2,
    placement.y + plane.size.height / 2 - viewH / 2,
    plane,
    viewW,
    viewH,
  );
