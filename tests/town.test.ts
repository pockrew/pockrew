import { describe, expect, it } from "vitest";

import type { Station, StationCell } from "#contracts/world.js";
import { assignCells, assignWorldCells, type WorldCell } from "#core/town.js";

/** Cell-count of the square ring max(|x|, |y|) === ring (ring 1 = 8, ring 2 = 16, …). */
const ring = (cell: { x: number; y: number }): number => Math.max(Math.abs(cell.x), Math.abs(cell.y));

describe("assignCells: station placement on a project's town grid", () => {
  it("pins HQ to the center cell", () => {
    const placed = assignCells([], ["hq"], "proj-1");
    expect(placed).toEqual([{ station: "hq", x: 0, y: 0 }]);
  });

  // Twin-drift guard: a parallel web-side agent pins this exact same value independently. Any
  // change to the hash, the ring walk order, or the missing-key sort breaks CI on both sides
  // rather than silently drifting the renderer and the persisted grid apart.
  it("places a known key at its exact, pinned coordinate (twin-drift guard)", () => {
    expect(assignCells([], ["hq", "library"], "proj-1")).toEqual([
      { station: "hq", x: 0, y: 0 },
      { station: "library", x: 0, y: -1 },
    ]);
  });

  it("is deterministic regardless of the order neededStations arrives in", () => {
    const stations: Station[] = ["hq", "library", "workshop", "lab", "review", "boss_desk", "lounge"];
    const a = assignCells([], stations, "proj-1");
    const b = assignCells([], [...stations].reverse(), "proj-1");
    const sortKey = (c: StationCell): string => c.station;
    expect([...a].sort((x, y) => sortKey(x).localeCompare(sortKey(y)))).toEqual(
      [...b].sort((x, y) => sortKey(x).localeCompare(sortKey(y))),
    );
  });

  it("returns only the stations missing from existing — never re-placing one already there", () => {
    const existing: StationCell[] = [{ station: "hq", x: 0, y: 0 }];
    const placed = assignCells(existing, ["hq", "library"], "proj-1");
    expect(placed.map((c) => c.station)).toEqual(["library"]);
  });

  it("never collides with an existing cell, even one outside the usual seeded spot", () => {
    // Force a collision: library's own seeded ring-1 cell is now occupied by something else.
    const existing: StationCell[] = [{ station: "hq", x: 0, y: 0 }];
    const first = assignCells(existing, ["library"], "proj-collide")[0]!;
    const blocked = [...existing, { station: "workshop", x: first.x, y: first.y } as StationCell];
    const second = assignCells(blocked, ["library"], "proj-collide")[0]!;
    expect(second).not.toEqual({ station: "library", x: first.x, y: first.y });
    expect(ring(second)).toBeGreaterThanOrEqual(1);
  });

  it("fills ring 1 (8 cells) before spilling into ring 2 — grid grows 3×3 → 5×5", () => {
    // Real Station has only 6 non-HQ values; cast synthetic keys to exercise the grid math itself.
    const synthetic = Array.from({ length: 9 }, (_, i) => `station-${i}` as Station);
    const placed = assignCells([], synthetic, "proj-ring");
    const rings = placed.map(ring).sort((a, b) => a - b);
    expect(rings.filter((r) => r === 1)).toHaveLength(8); // ring 1 fully packed
    expect(rings.filter((r) => r === 2)).toHaveLength(1); // the 9th spills outward
    // Collision-free: 9 distinct cells for 9 distinct stations.
    const keys = new Set(placed.map((c) => `${c.x},${c.y}`));
    expect(keys.size).toBe(9);
  });
});

describe("assignWorldCells: town placement on the whole-machine world grid", () => {
  it("pins the very first project ever seen to the center cell", () => {
    const placed = assignWorldCells([], ["proj-1"]);
    expect(placed).toEqual([{ projectId: "proj-1", x: 0, y: 0 }]);
  });

  it("claims a seeded ring cell for later projects once the center is taken", () => {
    const existing: WorldCell[] = [{ projectId: "proj-1", x: 0, y: 0 }];
    const placed = assignWorldCells(existing, ["proj-2"]);
    expect(placed).toHaveLength(1);
    expect(placed[0]).not.toEqual({ projectId: "proj-2", x: 0, y: 0 });
    expect(ring(placed[0]!)).toBeGreaterThanOrEqual(1);
  });

  it("is deterministic and collision-free across many new projects at once", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `proj-${i}`);
    const a = assignWorldCells([], ids);
    const b = assignWorldCells([], [...ids].reverse());
    const byId = (rows: WorldCell[]): WorldCell[] => [...rows].sort((x, y) => x.projectId.localeCompare(y.projectId));
    expect(byId(a)).toEqual(byId(b));
    expect(new Set(a.map((c) => `${c.x},${c.y}`)).size).toBe(ids.length); // no two projects share a cell
  });

  it("returns nothing when every needed project is already placed", () => {
    const existing: WorldCell[] = [{ projectId: "proj-1", x: 0, y: 0 }];
    expect(assignWorldCells(existing, ["proj-1"])).toEqual([]);
  });
});
