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

/** One building cell. The plate is `side` × `side` of these, so it covers the town exactly.
 *  Sized so two ~90px game units stand side by side at a building's foot without spilling;
 *  three would need a ~290px cell (a town nearly twice as wide), so three-plus folds instead. */
const CELL = { width: 200, height: 160 };

export const CELL_SIZE = CELL;

/** Plate of a `side`×`side` town. Grows with the grid instead of being a fixed oversized rect. */
export const plateSize = (side: number): { width: number; height: number } => ({
  width: side * CELL.width,
  height: side * CELL.height,
});

/** The plate a 3×3 town sits on — the size the world grid paces itself by until a town outgrows it. */
export const PLATE_SIZE = plateSize(3);

/** Chips stand at the foot of their building, side by side first (two guards at the door), then
 *  a second row. A unit is ~90px wide, ~76px tall; the pitches pace by that footprint and leave
 *  headroom for the status pill and speech bubble. */
const CHIP_INSET = { x: 10, y: 86 };
const CHIP_PITCH = 84;
const UNITS_PER_ROW = 2;
const UNIT_PITCH = 94;
/** Where a relationship link attaches to a chip: roughly the avatar's chest. */
const ANCHOR_DX = 44;
const ANCHOR_DY = 38;
/** Where the unit visually stands relative to its own top-left — its feet, mid avatar. */
export const CHIP_FOOT = { x: 44, y: 48 };
/** Every crowd folds from five: up to four units hold a spot's four corners (a 2×2 formation) —
 *  just enough to read busy without piling; a fifth folds the crowd into one stack. Applies to
 *  station crews, the lounge and the memorial hall alike. */
const FOLD_FROM = 5;

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

/** A folded crowd: a crowded station's crew, or the idle / ended benches. Click opens the roster. */
export type CrewCluster = {
  /** Stable roster key: `station:<name>` | "idle" | "ended". */
  key: string;
  label: string;
  kind: "active" | "idle" | "ended";
  x: number;
  y: number;
  actors: ActorView[];
};

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
  clusters: CrewCluster[];
  /** Walk route between two stations (then to the chip's spot), following the roads. Null when
   *  the origin station is gone from this plate. */
  travelPath: (from: Station, to: Station, spot: Point) => Travel | null;
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

/** Walk pacing: one --dur-walk per cell hopped, capped so a cross-town trek never drags. */
export const travelFactor = (routeCells: number): number => Math.min(6, Math.max(1, routeCells - 1));

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
};

export const layoutDistrict = ({ project, actors, activities, now }: LayoutInput): DistrictLayout => {
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
    // Row-first: the second unit stands beside the first, never on a "floor" below it.
    return {
      x: base.x + CHIP_INSET.x + (slot % UNITS_PER_ROW) * UNIT_PITCH,
      y: base.y + CHIP_INSET.y + Math.floor(slot / UNITS_PER_ROW) * CHIP_PITCH,
    };
  };

  // Three crowds, three treatments: up to four active units hold a building's corners (2×2), a
  // fifth folds the crew into one overlapping stack; idle and ended each gather on their own
  // bench from two. A resting actor holding open attention never folds — hiding it would hide
  // work (isResting).
  const idle = actors.filter((a) => isResting(a) && a.state === "idle");
  const ended = actors.filter((a) => isResting(a) && a.state === "ended");
  const active = actors.filter((a) => !isResting(a));
  const activeByStation = new Map<Station, ActorView[]>();
  for (const a of active) {
    const crew = activeByStation.get(a.station) ?? [];
    crew.push(a);
    activeByStation.set(a.station, crew);
  }

  // The memorial hall: where ended sessions gather, its own spot at the plate's foot — off every
  // working building. A persisted building would need a new Station in the frozen contract
  // (town_layout keys on Station), so this stays render-only until the owner approves one.
  const memorial: Point = { x: plate.width - 2 * UNIT_PITCH - 10, y: plate.height - 84 };
  let memorialTaken = 0;
  const nextMemorialSlot = (): Point => {
    const slot = memorialTaken;
    memorialTaken += 1;
    return {
      x: memorial.x + (slot % UNITS_PER_ROW) * UNIT_PITCH,
      y: memorial.y + Math.floor(slot / UNITS_PER_ROW) * CHIP_PITCH,
    };
  };

  const hidden = new Set<string>();
  const clusters: CrewCluster[] = [];
  for (const [station, crew] of activeByStation) {
    if (crew.length < FOLD_FROM) continue;
    for (const a of crew) hidden.add(a.id);
    const at = nextSlot(station);
    clusters.push({ key: `station:${station}`, label: STATION_LABEL[station], kind: "active", ...at, actors: crew });
  }
  if (idle.length >= FOLD_FROM) {
    for (const a of idle) hidden.add(a.id);
    // The idle crew rests at the lounge when the town has one, otherwise at the anchor.
    const at = nextSlot(byStation.has("lounge") ? "lounge" : "hq");
    clusters.push({ key: "idle", label: "lounge", kind: "idle", ...at, actors: idle });
  }
  if (ended.length >= FOLD_FROM) {
    for (const a of ended) hidden.add(a.id);
    clusters.push({ key: "ended", label: "memorial hall", kind: "ended", ...memorial, actors: ended });
  }

  const endedIds = new Set(ended.map((a) => a.id));
  const placed = new Map<string, Point>();
  const chips: ChipPlacement[] = [];
  for (const actor of actors) {
    if (hidden.has(actor.id)) continue;
    // An unfolded ended unit stands at the memorial hall, not back at its old building —
    // otherwise the separate resting places would only exist while folded.
    const at = endedIds.has(actor.id) ? nextMemorialSlot() : nextSlot(actor.station);
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

  const travelPath = (from: Station, to: Station, spot: Point): Travel | null => {
    const start = cells.get(from);
    if (!start) return null; // that station was never built here, so there is no road to walk
    // The street network is a star through the anchor, so a walk is old station → anchor → new
    // station, then the last few pixels to the chip's own spot — never a straight flight across
    // the plate. Both legs must reuse the exact cells the roads were DRAWN from: cellPath is
    // x-first and therefore asymmetric, so the outbound leg is the destination's own drawn road
    // (cellPath(dest → CENTER)) walked in reverse — cellPath(CENTER → dest) would flip the L and
    // send the character across cells that have no street.
    const dest = cells.get(to);
    const route = dest
      ? [...cellPath(start, CENTER), ...cellPath(dest, CENTER).reverse().slice(1)]
      : cellPath(start, CENTER);
    // The chip's offset-path anchors its top-left corner, but the character visually stands at
    // its feet — shift the road points so the feet track the street's center line.
    const onRoad = (c: Cell): Point => {
      const at = center(c);
      return { x: at.x - CHIP_FOOT.x, y: at.y - CHIP_FOOT.y };
    };
    const points = [...route.map(onRoad), spot];
    // Paced per node: --dur-walk is one cell's worth of walking, hops multiply it.
    return { d: polyline(points), factor: travelFactor(route.length) };
  };

  return { side, plate, stations, roads, roadCells, chips, links, clusters, travelPath };
};
