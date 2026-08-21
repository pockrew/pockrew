import { expect, test } from "vitest";

import { cellKey, cellPath, CENTER, gridSide, gridSideFor, hash, placeCells, ringCells, ringOf } from "./grid";

const seed = (key: string) => key.length; // deterministic and easy to reason about in a test

test("the seeded cell is pinned to the literal the server's engine produces", () => {
  // Twin guard for src/core/town.ts. Every other test here exercises the ring maths with a toy seed;
  // this one runs the REAL FNV-1a hash on the real key format and pins the concrete cell, so drift in
  // either side's hash, ring order or probing shows up as a failure instead of as a town that
  // silently jumps the first time the server persists it. tests/town.test.ts pins the same literal:
  // assignCells([], ["hq", "library"], "proj-1") puts library on (0, -1) too.
  expect(placeCells([], ["library"], (key) => hash(`proj-1:${key}`)).get("library")).toEqual({ x: 0, y: -1 });
  // The hash itself, so a change to it is unmistakable in the diff rather than inferred.
  expect(hash("proj-1:library") % 8).toBe(1);
});

test("a ring holds 8r cells, all at that Chebyshev distance", () => {
  expect(ringCells(0)).toEqual([CENTER]);
  for (const ring of [1, 2, 3]) {
    const cells = ringCells(ring);
    expect(cells).toHaveLength(8 * ring);
    expect(new Set(cells.map(cellKey)).size).toBe(cells.length);
    for (const cell of cells) expect(ringOf(cell)).toBe(ring);
  }
});

test("a ring is walked clockwise from its top-left corner", () => {
  expect(ringCells(1)).toEqual([
    { x: -1, y: -1 },
    { x: 0, y: -1 },
    { x: 1, y: -1 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
    { x: -1, y: 1 },
    { x: -1, y: 0 },
  ]);
});

test("the side is the smallest odd n with n squared minus one cells around the center", () => {
  expect(gridSide(0)).toBe(3);
  expect(gridSide(8)).toBe(3);
  expect(gridSide(9)).toBe(5);
  expect(gridSide(24)).toBe(5);
  expect(gridSide(25)).toBe(7);
});

test("the side grows to contain the cells it is given, and never shrinks below them", () => {
  expect(gridSideFor([], 0)).toBe(3);
  // A cell out on ring 2 forces a 5x5 plate even though one ring would have held the count.
  expect(gridSideFor([{ x: 0, y: -2 }], 1)).toBe(5);
  expect(gridSideFor([{ x: -3, y: 1 }], 1)).toBe(7);
  // Growing is additive: the cells already placed keep the coordinates they had.
  expect(gridSideFor([CENTER], 30)).toBe(7);
});

test("the pinned key takes the center and everyone else lands on a free ring cell", () => {
  const placed = placeCells([], ["hq", "lab", "library"], seed, "hq");
  expect(placed.get("hq")).toEqual(CENTER);
  expect(ringOf(placed.get("lab")!)).toBe(1);
  expect(ringOf(placed.get("library")!)).toBe(1);
  expect(placed.size).toBe(3);
});

test("placement is deterministic and ignores caller order", () => {
  const forward = placeCells([], ["a", "bb", "ccc", "dddd"], seed);
  const backward = placeCells([], ["dddd", "ccc", "bb", "a"], seed);
  expect([...forward].sort()).toEqual([...backward].sort());
});

test("cells already placed are never handed out twice", () => {
  const existing = ringCells(1).slice(0, 3);
  const placed = placeCells(existing, ["a", "bb"], seed);
  const taken = new Set(existing.map(cellKey));
  for (const cell of placed.values()) expect(taken.has(cellKey(cell))).toBe(false);
  expect(new Set([...placed.values()].map(cellKey)).size).toBe(placed.size);
});

test("a full ring spills outwards instead of overlapping", () => {
  // Ring 1 is entirely taken, so the next key has to land on ring 2.
  const placed = placeCells(ringCells(1), ["a"], seed);
  expect(ringOf(placed.get("a")!)).toBe(2);
});

test("more keys than one ring holds still all get their own cell", () => {
  const keys = Array.from({ length: 30 }, (_, i) => `k${i}`);
  const placed = placeCells([], keys, (key) => key.charCodeAt(1) * 7);
  expect(placed.size).toBe(30);
  expect(new Set([...placed.values()].map(cellKey)).size).toBe(30);
});

test("a cell path runs along x first, then y, with both ends included", () => {
  expect(cellPath({ x: 2, y: -1 }, CENTER)).toEqual([
    { x: 2, y: -1 },
    { x: 1, y: -1 },
    { x: 0, y: -1 },
    { x: 0, y: 0 },
  ]);
  expect(cellPath(CENTER, CENTER)).toEqual([CENTER]);
  expect(cellPath({ x: 0, y: 2 }, CENTER)).toEqual([
    { x: 0, y: 2 },
    { x: 0, y: 1 },
    { x: 0, y: 0 },
  ]);
});

test("a cell path only ever steps one cell at a time", () => {
  const path = cellPath({ x: -3, y: 2 }, CENTER);
  for (let i = 1; i < path.length; i += 1) {
    const step = Math.abs(path[i]!.x - path[i - 1]!.x) + Math.abs(path[i]!.y - path[i - 1]!.y);
    expect(step).toBe(1);
  }
  expect(path.at(-1)).toEqual(CENTER);
});
