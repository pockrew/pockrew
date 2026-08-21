import type { Station, StationCell } from "#contracts/world.js";

/**
 * Center-out grid placement, pure and deterministic (same existing+needed → same cells, in any
 * input order — spec "Persistence": station cells persist per project, actor/town coordinates are
 * never invented twice). Two levels share this one engine:
 *  - a project's own town: stations placed on a per-project grid, HQ pinned to the center cell.
 *  - the whole-machine world: towns themselves placed on one shared grid, the very first project
 *    ever seen pinned to the center cell.
 *
 * Coordinate convention: signed cell coordinates, center always (0, 0). This is the one convention
 * that lets the grid grow (3×3 → 5×5 → 7×7 as inner rings fill) without ever moving an already-
 * placed cell — growth only ever adds an outer ring, never renumbers an inner one.
 *
 * Ring r (r ≥ 1) is the square annulus max(|x|, |y|) === r, walked clockwise from its top-left
 * corner; ring 0 is just the center. Ring r holds 8r cells (3×3 ring1 = 8, 5×5 ring2 = 16, …).
 */

/** Same shape the frozen contract derives `ProjectView.worldCell` as — never re-declared. */
type Cell = Omit<StationCell, "station">;

/** FNV-1a — the same tiny stable hash src/web/lib/district-layout.ts seeds a town's stations with,
 *  so a station's seeded starting guess matches what the (pre-persistence) renderer already showed. */
const hash = (text: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

const ringCells = (ring: number): Cell[] => {
  if (ring === 0) return [{ x: 0, y: 0 }];
  const cells: Cell[] = [];
  for (let x = -ring; x <= ring; x += 1) cells.push({ x, y: -ring }); // top, left → right
  for (let y = -ring + 1; y <= ring; y += 1) cells.push({ x: ring, y }); // right, top → bottom
  for (let x = ring - 1; x >= -ring; x -= 1) cells.push({ x, y: ring }); // bottom, right → left
  for (let y = ring - 1; y >= -ring + 1; y -= 1) cells.push({ x: -ring, y }); // left, bottom → top
  return cells;
};

/**
 * Assigns every key in `missing` the next free cell, innermost ring first, spilling to the next
 * ring out once the current one has no room. `pinnedKey`, when present, unplaced and the center
 * cell is still free, always claims (0, 0) regardless of its hash — every other key's cell is
 * seeded by `seed(key)` and linear-probed within its ring (mirrors district-layout.ts's
 * `seedStationCells`), so a collision shifts a key to the next free cell instead of displacing
 * one already placed. `missing` is sorted internally, so caller order never affects the result.
 */
const placeCells = (
  existingCells: readonly Cell[],
  missing: readonly string[],
  seed: (key: string) => number,
  pinnedKey?: string,
): Map<string, Cell> => {
  const taken = new Set(existingCells.map((c) => `${c.x},${c.y}`));
  const placements = new Map<string, Cell>();
  let rest = [...missing].sort((a, b) => a.localeCompare(b));

  if (pinnedKey !== undefined && !taken.has("0,0") && rest.includes(pinnedKey)) {
    placements.set(pinnedKey, { x: 0, y: 0 });
    taken.add("0,0");
    rest = rest.filter((k) => k !== pinnedKey);
  }

  for (const key of rest) {
    const start = seed(key);
    for (let ring = 1; ; ring += 1) {
      const cells = ringCells(ring);
      const size = cells.length;
      const from = start % size;
      let found: Cell | undefined;
      for (let i = 0; i < size; i += 1) {
        const cell = cells[(from + i) % size]!;
        const key2 = `${cell.x},${cell.y}`;
        if (!taken.has(key2)) {
          found = cell;
          taken.add(key2);
          break;
        }
      }
      if (found) {
        placements.set(key, found);
        break;
      }
      // ring full — spill outward (n grows 3 → 5 → 7 → … as inner rings fill)
    }
  }
  return placements;
};

/**
 * New station cells for one project's town — only the ones `existing` doesn't already have.
 * Returns solely the new placements; a station already in `existing` never moves (spec principle:
 * "Station cells persist per project" — placed once, immutable).
 */
export const assignCells = (
  existing: readonly StationCell[],
  neededStations: readonly Station[],
  projectId: string,
): StationCell[] => {
  const already = new Set(existing.map((c) => c.station));
  const missing = neededStations.filter((s) => !already.has(s));
  if (missing.length === 0) return [];
  const placements = placeCells(existing, missing, (station) => hash(`${projectId}:${station}`), "hq");
  return missing.map((station) => ({ station, ...placements.get(station)! }));
};

/** One town's cell on the shared whole-machine world grid. */
export type WorldCell = Cell & { projectId: string };

/**
 * New world cells for whichever projects `existing` doesn't already place — only the new ones,
 * same immutability rule as `assignCells`. The very first project the machine ever sees (i.e.
 * `existing` is empty) is pinned to the center cell; every later one is seeded by its own id.
 */
export const assignWorldCells = (existing: readonly WorldCell[], neededProjectIds: readonly string[]): WorldCell[] => {
  const already = new Set(existing.map((c) => c.projectId));
  const missing = neededProjectIds.filter((id) => !already.has(id));
  if (missing.length === 0) return [];
  const pinnedKey = existing.length === 0 ? [...missing].sort((a, b) => a.localeCompare(b))[0] : undefined;
  const placements = placeCells(existing, missing, (id) => hash(id), pinnedKey);
  return missing.map((projectId) => ({ projectId, ...placements.get(projectId)! }));
};
