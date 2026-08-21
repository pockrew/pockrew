import type { StationCell } from "#contracts/world.js";

/**
 * The center-out square grid both levels of the world are built on: a town's stations on its plate,
 * and the towns themselves on the whole-machine plane.
 *
 * Coordinate convention: signed cells, center always (0, 0). Ring r (r ≥ 1) is the square annulus
 * max(|x|, |y|) === r, walked clockwise from its top-left corner; ring 0 is the center alone. Ring r
 * holds 8r cells. Growth (3×3 → 5×5 → 7×7) only ever adds an outer ring, so a cell that has been
 * placed — and persisted — never moves or gets renumbered.
 *
 * ⚠️ Deliberate twin of `src/core/town.ts` (`placeCells`), which is what the server persists with.
 * The layer boundary forbids web → core, so the fallback used before a town is persisted has to
 * mirror the engine rather than import it: same hash, same ring probing, same sort, same pinning, so
 * a seeded town and a persisted town look identical. Change one, change both.
 */

/** One grid cell. The persisted cell shape minus its station, so both levels share one type. */
export type Cell = Omit<StationCell, "station">;

export const CENTER: Cell = { x: 0, y: 0 };

export const cellKey = (cell: Cell): string => `${cell.x},${cell.y}`;

/** FNV-1a — the same tiny stable hash `src/core/town.ts` seeds with. */
export const hash = (text: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

/** Which ring a cell sits on: Chebyshev distance from the center. */
export const ringOf = (cell: Cell): number => Math.max(Math.abs(cell.x), Math.abs(cell.y));

/** One ring, clockwise from its top-left corner. Ring 0 is the center alone. */
export const ringCells = (ring: number): Cell[] => {
  if (ring === 0) return [CENTER];
  const cells: Cell[] = [];
  for (let x = -ring; x <= ring; x += 1) cells.push({ x, y: -ring }); // top, left → right
  for (let y = -ring + 1; y <= ring; y += 1) cells.push({ x: ring, y }); // right, top → bottom
  for (let x = ring - 1; x >= -ring; x -= 1) cells.push({ x, y: ring }); // bottom, right → left
  for (let y = ring - 1; y >= -ring + 1; y -= 1) cells.push({ x: -ring, y }); // left, bottom → top
  return cells;
};

/** Smallest odd side whose non-center cells fit `count` of them. Never smaller than 3. */
export const gridSide = (count: number): number => {
  let side = 3;
  while (side * side - 1 < count) side += 2;
  return side;
};

/**
 * Side that both fits `count` placed cells and contains every cell in `cells`. A grid only ever
 * grows outwards around what is already placed, so this is the one thing the plate size reads.
 */
export const gridSideFor = (cells: Iterable<Cell>, count: number): number => {
  let side = gridSide(count);
  for (const cell of cells) side = Math.max(side, ringOf(cell) * 2 + 1);
  return side;
};

/**
 * Assigns every key in `missing` a free cell, innermost ring first, spilling outwards once a ring
 * is full. `pinnedKey` claims the center when it is free and unplaced; every other key is seeded by
 * `seed(key)` and linear-probed within its ring, so a collision shifts the newcomer instead of
 * displacing a key already placed. `missing` is sorted internally: caller order never matters.
 */
export const placeCells = (
  existing: readonly Cell[],
  missing: readonly string[],
  seed: (key: string) => number,
  pinnedKey?: string,
): Map<string, Cell> => {
  const taken = new Set(existing.map(cellKey));
  const placed = new Map<string, Cell>();
  let rest = [...missing].sort((a, b) => a.localeCompare(b));

  if (pinnedKey !== undefined && !taken.has(cellKey(CENTER)) && rest.includes(pinnedKey)) {
    placed.set(pinnedKey, CENTER);
    taken.add(cellKey(CENTER));
    rest = rest.filter((key) => key !== pinnedKey);
  }

  for (const key of rest) {
    const start = seed(key);
    // Ring by ring outwards; the seed picks the entry point, then probe forward around the ring.
    for (let ring = 1; !placed.has(key); ring += 1) {
      const cells = ringCells(ring);
      const from = start % cells.length;
      for (let i = 0; i < cells.length; i += 1) {
        const cell = cells[(from + i) % cells.length]!;
        if (taken.has(cellKey(cell))) continue;
        taken.add(cellKey(cell));
        placed.set(key, cell);
        break;
      }
    }
  }
  return placed;
};

/** Manhattan path of cells from `from` to `to`, along x first then y. Both ends included. */
export const cellPath = (from: Cell, to: Cell): Cell[] => {
  const path: Cell[] = [{ x: from.x, y: from.y }];
  let { x, y } = from;
  while (x !== to.x) {
    x += Math.sign(to.x - x);
    path.push({ x, y });
  }
  while (y !== to.y) {
    y += Math.sign(to.y - y);
    path.push({ x, y });
  }
  return path;
};
