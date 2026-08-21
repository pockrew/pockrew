import type { ActivityView, ActorView, ProjectView, Station } from "#contracts/world.js";

import { cellKey, cellPath, CENTER, gridSideFor, hash, placeCells, type Cell } from "./grid";
import { RECENT_WINDOW_MS, STATION_BY_CATEGORY, STATION_LABEL, STATION_ORDER } from "./world-meta";

/**
 * How one district is laid out on its plate: which stations exist at all, which grid cell each one
 * stands on, the roads between them, and where each character sits.
 *
 * The town is a square center-out grid with HQ pinned to the middle cell (lib/grid). Cells come from
 * the server when it has persisted them (`ProjectView.stationCells`) and from the same seeded
 * placement the server uses when it has not, so a town does not jump the moment persistence catches
 * up. Everything here is pure: the only clock is the `now` passed in.
 */

/** One building cell. The plate is `side` × `side` of these, so it covers the town exactly. */
const CELL = { width: 152, height: 140 };

export const CELL_SIZE = CELL;

/** Plate of a `side`×`side` town. Grows with the grid instead of being a fixed oversized rect. */
export const plateSize = (side: number): { width: number; height: number } => ({
  width: side * CELL.width,
  height: side * CELL.height,
});

/** The plate a 3×3 town sits on — the size the world grid paces itself by until a town outgrows it. */
export const PLATE_SIZE = plateSize(3);

/** Chips sit at the foot of their building and stack downwards. */
const CHIP_INSET = { x: 8, y: 84 };
const CHIP_PITCH = 44;
const ROWS_PER_COLUMN = 2;
const COLUMN_PITCH = 118;
/** Where a relationship link attaches to a chip: left edge, mid height. */
const ANCHOR_DX = 10;
const ANCHOR_DY = 15;
/** One resting actor is not a stack — folding starts to pay off at two. */
const CLUSTER_MIN = 2;

const RESTING_STATES: ReadonlySet<ActorView["state"]> = new Set(["idle", "ended"]);
/** A link only flows while the subagent is actually doing something. */
const FLOWING_STATES: ReadonlySet<ActorView["state"]> = new Set(["starting", "thinking", "working"]);

export type Point = { x: number; y: number };

export type StationPlacement = { station: Station; label: string; cell: Cell; x: number; y: number; center: Point };

/** Which sides of a road cell continue into another road cell. */
export type RoadSides = { n: boolean; e: boolean; s: boolean; w: boolean };

/** Shape of the junction a road cell has to draw. One PNG road tile per kind, once they land. */
export type RoadKind = "end" | "straight" | "corner" | "t" | "cross";

/**
 * One cell the town's streets run through. The SVG stroke renders from `Road.d` today; a tile
 * renderer reads `sides`/`kind` instead and needs no change here (data-only swap).
 */
export type RoadCell = Cell & { sides: RoadSides; kind: RoadKind };

/** One station's street to the anchor, as an SVG path through the cell centers it passes. */
export type Road = { id: Station; d: string };

export type Travel = { d: string; factor: number };

export type ChipPlacement = {
  actor: ActorView;
  x: number;
  y: number;
  /** Offset back to the HQ cell, so an arriving character pops in at the anchor and walks out. */
  spawnDx: number;
  spawnDy: number;
};

export type ChipLink = { id: string; x1: number; y1: number; x2: number; y2: number; active: boolean };

export type DistrictLayout = {
  /** Cells per side of this town's grid — always odd, always ≥ 3. */
  side: number;
  /** Exactly `side` × `side` cells of ground. The base covers its town and no more. */
  plate: { width: number; height: number };
  /** Every station this town has built, quiet ones included. Never a building without a signal. */
  stations: StationPlacement[];
  roads: Road[];
  /** The same streets as cells + connections, for the PNG road tiles. */
  roadCells: RoadCell[];
  chips: ChipPlacement[];
  links: ChipLink[];
  /** Null when there is nothing worth folding. `folded` is false while the cluster is expanded. */
  cluster: { x: number; y: number; actors: ActorView[]; folded: boolean } | null;
  /** Walk route from a station to a point, following the roads. Null when that station is gone. */
  travelPath: (from: Station, to: Point) => Travel | null;
};

/**
 * Stations a live signal is pointing at right now: HQ, wherever an actor stands, and whatever
 * category of work happened inside the window. This decides when a station is built for the FIRST
 * time — a workflow that never runs tests never gets a lab (AGENTS.md rule 7: never fake a signal).
 * It does not decide what stays: see `builtStations`.
 */
export const activeStations = (
  actors: readonly ActorView[],
  activities: readonly ActivityView[],
  now: number,
): Station[] => {
  const live = new Set<Station>(["hq"]);
  for (const actor of actors) live.add(actor.station);
  for (const activity of activities) {
    if ((activity.endedAt ?? activity.startedAt) >= now - RECENT_WINDOW_MS) {
      live.add(STATION_BY_CATEGORY[activity.category]);
    }
  }
  return STATION_ORDER.filter((station) => live.has(station));
};

/**
 * Every station this town has built, in canonical order. A building is permanent: once it exists it
 * keeps existing, whether or not anyone is working there — an empty workshop is an honest state, the
 * signal that built it really happened.
 *
 * `stationCells` is the server's built list, so it alone decides what stands. Live signals are only
 * unioned on top so a station appears the moment it is first used, before persistence catches up —
 * that union is also the whole fallback while `stationCells` is absent, where a station whose signal
 * ages out does still vanish. Zone A's persistence closes that gap for good.
 */
export const builtStations = (
  project: Pick<ProjectView, "stationCells">,
  actors: readonly ActorView[],
  activities: readonly ActivityView[],
  now: number,
): Station[] => {
  const built = new Set<Station>(activeStations(actors, activities, now));
  for (const cell of project.stationCells ?? []) built.add(cell.station);
  return STATION_ORDER.filter((station) => built.has(station));
};

/**
 * Grid cell per built station: the server's persisted cells win, the rest are seeded exactly the way
 * the server would have seeded them (lib/grid `placeCells`, hashed on `projectId:station`).
 *
 * HQ is pinned to the center whatever arrives — a persisted HQ anywhere else would break every road,
 * which all run to the middle. Persisted cells for stations that are not built are ignored: the
 * building is not there, so neither is its cell.
 */
export const townCells = (
  project: Pick<ProjectView, "id" | "stationCells">,
  built: readonly Station[],
): Map<Station, Cell> => {
  const wanted = new Set(built);
  const cells = new Map<Station, Cell>([["hq", CENTER]]);
  for (const cell of project.stationCells ?? []) {
    if (cell.station !== "hq" && wanted.has(cell.station)) cells.set(cell.station, { x: cell.x, y: cell.y });
  }
  const missing = STATION_ORDER.filter((station) => wanted.has(station) && !cells.has(station));
  const seeded = placeCells([...cells.values()], missing, (station) => hash(`${project.id}:${station}`));
  for (const [station, cell] of seeded) cells.set(station as Station, cell);
  return cells;
};

/** Junction shape from the open sides: two opposite sides run straight, two adjacent ones turn. */
export const roadKind = (sides: RoadSides): RoadKind => {
  const open = [sides.n, sides.e, sides.s, sides.w].filter(Boolean).length;
  if (open >= 4) return "cross";
  if (open === 3) return "t";
  if (open === 2) return sides.n === sides.s ? "straight" : "corner";
  return "end";
};

/**
 * Every cell the streets run through: the Manhattan path from each station cell to the anchor,
 * unioned, with each cell's open sides read back off that union. Order is stable — first station
 * first, its path outwards-in — so the tile list does not reshuffle between renders.
 */
export const roadNetwork = (from: Iterable<Cell>): RoadCell[] => {
  const on = new Set<string>();
  const order: Cell[] = [];
  for (const start of from) {
    for (const cell of cellPath(start, CENTER)) {
      if (on.has(cellKey(cell))) continue;
      on.add(cellKey(cell));
      order.push(cell);
    }
  }
  return order.map((cell) => {
    const sides = {
      n: on.has(cellKey({ x: cell.x, y: cell.y - 1 })),
      e: on.has(cellKey({ x: cell.x + 1, y: cell.y })),
      s: on.has(cellKey({ x: cell.x, y: cell.y + 1 })),
      w: on.has(cellKey({ x: cell.x - 1, y: cell.y })),
    };
    return { ...cell, sides, kind: roadKind(sides) };
  });
};

/** SVG path through the given points. Corners round via stroke-linejoin, so no arcs are needed. */
export const polyline = (points: readonly Point[]): string =>
  points.map((point, i) => `${i === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");

/** Manhattan length of a polyline — close enough to route length for pacing a walk. */
const pathLength = (points: readonly Point[]): number =>
  points.reduce((sum, point, i) => {
    const previous = points[i - 1];
    return previous ? sum + Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y) : sum;
  }, 0);

/** Longer walks take more time, but less time per pixel: the further you go, the more you run. */
export const travelFactor = (distance: number): number => Math.min(3, Math.max(1, distance / 220));

/** An idle actor still holding an open attention item stays visible — folding it would hide work. */
export const isResting = (actor: Pick<ActorView, "state" | "attentionIds">): boolean =>
  RESTING_STATES.has(actor.state) && actor.attentionIds.length === 0;

/**
 * Count per resting state, in precedence order, dropping empty ones. The fold label reports
 * "2 idle · 3 ended" instead of merging two different states into one word (rules/react.md: status
 * is icon + label + colour, and idle is not ended).
 */
export const restingBreakdown = (actors: readonly ActorView[]): Array<{ state: ActorView["state"]; count: number }> =>
  [...RESTING_STATES]
    .map((state) => ({ state, count: actors.filter((a) => a.state === state).length }))
    .filter((group) => group.count > 0);

type LayoutInput = {
  project: Pick<ProjectView, "id" | "stationCells">;
  actors: readonly ActorView[];
  activities: readonly ActivityView[];
  /** world.generatedAt — the only clock this module knows. */
  now: number;
  expanded: boolean;
};

export const layoutDistrict = ({ project, actors, activities, now, expanded }: LayoutInput): DistrictLayout => {
  const present = builtStations(project, actors, activities, now);
  const cells = townCells(project, present);
  // The plate grows to contain the cells it was given; the cells themselves never move.
  const side = gridSideFor(cells.values(), present.length - 1);
  const plate = plateSize(side);
  const origin = (cell: Cell): Point => ({
    x: (cell.x + (side - 1) / 2) * CELL.width,
    y: (cell.y + (side - 1) / 2) * CELL.height,
  });
  const center = (cell: Cell): Point => {
    const at = origin(cell);
    return { x: at.x + CELL.width / 2, y: at.y + CELL.height / 2 };
  };

  const stations: StationPlacement[] = present.map((station) => {
    const cell = cells.get(station)!;
    const at = origin(cell);
    return { station, label: STATION_LABEL[station], cell, x: at.x, y: at.y, center: center(cell) };
  });
  const byStation = new Map(stations.map((s) => [s.station, s]));
  const hq = byStation.get("hq")!;

  // Every station reaches the anchor along the grid; the town grows a street network as it grows.
  const outer = present.filter((station) => station !== "hq");
  const roads: Road[] = outer.map((station) => ({
    id: station,
    d: polyline(cellPath(cells.get(station)!, CENTER).map(center)),
  }));
  const roadCells = roadNetwork(outer.map((station) => cells.get(station)!));

  const taken = new Map<Station, number>();
  const nextSlot = (station: Station): Point => {
    const slot = taken.get(station) ?? 0;
    taken.set(station, slot + 1);
    // An actor at a station that was not built (stale signal) waits at the anchor instead.
    const base = byStation.get(station) ?? hq;
    return {
      x: base.x + CHIP_INSET.x + Math.floor(slot / ROWS_PER_COLUMN) * COLUMN_PITCH,
      y: base.y + CHIP_INSET.y + (slot % ROWS_PER_COLUMN) * CHIP_PITCH,
    };
  };

  const resting = actors.filter(isResting);
  const clusterable = resting.length >= CLUSTER_MIN;
  const hidden = new Set(clusterable && !expanded ? resting.map((a) => a.id) : []);

  const placed = new Map<string, Point>();
  const chips: ChipPlacement[] = [];
  for (const actor of actors) {
    if (hidden.has(actor.id)) continue;
    const at = nextSlot(actor.station);
    placed.set(actor.id, at);
    // Everyone arrives through the anchor, main agent and subagent alike: the pop-in happens on the
    // HQ cell and the walk out to the station is the entrance.
    chips.push({ actor, x: at.x, y: at.y, spawnDx: hq.center.x - at.x, spawnDy: hq.center.y - at.y });
  }

  // Second pass: a parent can appear after its child in the actor list.
  const links: ChipLink[] = [];
  for (const chip of chips) {
    const parentId = chip.actor.parentActorId;
    const parent = parentId === undefined ? undefined : placed.get(parentId);
    if (!parent) continue;
    links.push({
      id: chip.actor.id,
      x1: parent.x + ANCHOR_DX,
      y1: parent.y + ANCHOR_DY,
      x2: chip.x + ANCHOR_DX,
      y2: chip.y + ANCHOR_DY,
      active: FLOWING_STATES.has(chip.actor.state),
    });
  }

  // The resting crowd gathers at the lounge when the town has one, otherwise at the anchor.
  const cluster = clusterable
    ? { ...nextSlot(byStation.has("lounge") ? "lounge" : "hq"), actors: resting, folded: !expanded }
    : null;

  const travelPath = (from: Station, to: Point): Travel | null => {
    const start = cells.get(from);
    if (!start) return null; // that station was never built here, so there is no road to walk
    // Along the road to the anchor cell, then the last few pixels to the chip's own spot.
    const points = [...cellPath(start, CENTER).map(center), to];
    return { d: polyline(points), factor: travelFactor(pathLength(points)) };
  };

  return { side, plate, stations, roads, roadCells, chips, links, cluster, travelPath };
};
