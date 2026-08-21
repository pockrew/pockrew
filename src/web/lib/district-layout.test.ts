import { expect, test } from "vitest";

import type { ActivityView, ActorView, StationCell } from "#contracts/world.js";

import {
  activeStations,
  builtStations,
  CELL_SIZE,
  CHIP_FOOT,
  layoutDistrict,
  plateSize,
  restingBreakdown,
  roadKind,
  roadNetwork,
  townCells,
  travelFactor,
} from "./district-layout";
import { cellKey, CENTER, ringOf } from "./grid";
import { RECENT_WINDOW_MS } from "./world-meta";

const NOW = 1_800_000_000_000;

const actor = (id: string, over: Partial<ActorView> = {}): ActorView => ({
  id,
  projectId: "p1",
  sessionId: "s1",
  source: "claude",
  displayName: id,
  state: "idle",
  stateConfidence: "observed",
  station: "lounge",
  attentionIds: [],
  startedAt: 0,
  updatedAt: 0,
  ...over,
});

const activity = (over: Partial<ActivityView> = {}): ActivityView => ({
  id: "act",
  actorId: "a",
  projectId: "p1",
  category: "code",
  status: "running",
  confidence: "observed",
  startedAt: NOW - 60_000,
  ...over,
});

const layout = (over: Partial<Parameters<typeof layoutDistrict>[0]> = {}) =>
  layoutDistrict({ project: { id: "p1" }, actors: [], activities: [], now: NOW, ...over });

const cell = (station: StationCell["station"], x: number, y: number): StationCell => ({ station, x, y });

test("a brand-new district is only the HQ anchor", () => {
  expect(activeStations([], [], NOW)).toEqual(["hq"]);
  const only = layout();
  expect(only.stations.map((s) => s.station)).toEqual(["hq"]);
  expect(only.roads).toEqual([]);
});

test("a station exists once a real signal put it there, and not before", () => {
  const withActor = activeStations([actor("a", { station: "workshop" })], [], NOW);
  expect(withActor).toEqual(["hq", "workshop"]);

  const withActivity = activeStations([], [activity({ category: "terminal" })], NOW);
  expect(withActivity).toEqual(["hq", "lab"]);

  // Out of the window: the building is not rendered any more (the data is untouched).
  const stale = activeStations([], [activity({ startedAt: NOW - RECENT_WINDOW_MS - 1 })], NOW);
  expect(stale).toEqual(["hq"]);
});

test("stations keep the canonical order however the signals arrive", () => {
  const stations = activeStations(
    [actor("a", { station: "lounge" }), actor("b", { station: "library" })],
    [activity({ category: "review" })],
    NOW,
  );
  expect(stations).toEqual(["hq", "library", "review", "lounge"]);
});

test("a station that has ever been built is permanent, however quiet it goes", () => {
  const persisted = { id: "p1", stationCells: [cell("workshop", 1, 0), cell("lab", 0, 1)] };
  // Nobody working anywhere, nothing in the window: the buildings still stand.
  expect(builtStations(persisted, [], [], NOW)).toEqual(["hq", "workshop", "lab"]);
  const quiet = layoutDistrict({ project: persisted, actors: [], activities: [], now: NOW });
  expect(quiet.stations.map((s) => s.station)).toEqual(["hq", "workshop", "lab"]);
  // An aged-out signal cannot demolish a persisted station either.
  const stale = [activity({ category: "code", startedAt: NOW - RECENT_WINDOW_MS - 1 })];
  expect(builtStations(persisted, [], stale, NOW)).toEqual(["hq", "workshop", "lab"]);
});

test("a live signal only ever adds a station, never removes one", () => {
  const persisted = { id: "p1", stationCells: [cell("workshop", 1, 0)] };
  const grown = builtStations(persisted, [actor("a", { station: "lounge" })], [], NOW);
  expect(grown).toEqual(["hq", "workshop", "lounge"]);
});

test("HQ is always the center cell, whatever the server persisted for it", () => {
  const cells = townCells({ id: "p1", stationCells: [cell("hq", 2, 2), cell("lab", 1, 0)] }, ["hq", "lab"]);
  expect(cells.get("hq")).toEqual(CENTER);
  expect(cells.get("lab")).toEqual({ x: 1, y: 0 });
});

test("persisted cells win over the seed, and the seed only fills what is missing", () => {
  const built = ["hq", "library", "workshop"] as const;
  const seeded = townCells({ id: "p1" }, built);
  const mixed = townCells({ id: "p1", stationCells: [cell("library", 2, -1)] }, built);
  expect(mixed.get("library")).toEqual({ x: 2, y: -1 });
  // The seeded station keeps its own cell — a persisted neighbour never displaces it.
  expect(mixed.get("workshop")).toEqual(seeded.get("workshop"));
  expect(mixed.get("workshop")).not.toEqual({ x: 2, y: -1 });
});

test("the seed fallback is per project: same id repeats, different ids differ", () => {
  const built = ["hq", "library", "workshop", "lab"] as const;
  const a = townCells({ id: "proj-alpha" }, built);
  const b = townCells({ id: "proj-alpha" }, built);
  const c = townCells({ id: "proj-beta" }, built);
  expect([...a]).toEqual([...b]);
  expect([...a]).not.toEqual([...c]);
});

test("seeded cells never collide, sit on the rings from the center out, and stay on the plate", () => {
  const built = ["hq", "library", "workshop", "lab", "review", "boss_desk", "lounge"] as const;
  for (const id of ["p1", "p2", "acme-shop", "pockrew", "x"]) {
    const cells = [...townCells({ id }, built).values()];
    expect(new Set(cells.map(cellKey)).size).toBe(cells.length);
    // Six non-HQ stations fit inside ring 1, so a full town is still a 3x3 plate.
    for (const c of cells) expect(ringOf(c)).toBeLessThanOrEqual(1);
  }
  const placed = layout({ actors: built.map((station, i) => actor(`a${i}`, { station, state: "working" })) });
  expect(placed.side).toBe(3);
  expect(placed.plate).toEqual(plateSize(3));
  for (const station of placed.stations) {
    expect(station.center.x).toBeLessThan(placed.plate.width);
    expect(station.center.y).toBeLessThan(placed.plate.height);
  }
});

test("the plate grows around persisted cells instead of moving them", () => {
  const far = layoutDistrict({
    project: { id: "p1", stationCells: [cell("lab", 0, -2)] },
    actors: [],
    activities: [],
    now: NOW,
  });
  expect(far.side).toBe(5);
  expect(far.plate).toEqual(plateSize(5));
  const lab = far.stations.find((s) => s.station === "lab")!;
  expect(lab.cell).toEqual({ x: 0, y: -2 });
  // HQ still sits dead center of the bigger plate.
  const hq = far.stations.find((s) => s.station === "hq")!;
  expect(hq.center).toEqual({ x: far.plate.width / 2, y: far.plate.height / 2 });
});

test("a station that appears keeps the spot the seed gave it", () => {
  const before = layout({ actors: [actor("a", { station: "library" })] });
  const after = layout({ actors: [actor("a", { station: "library" }), actor("b", { station: "lab" })] });
  const spot = (l: typeof before, s: string) => l.stations.find((x) => x.station === s);
  expect(spot(after, "library")).toEqual(spot(before, "library"));
  expect(spot(after, "hq")).toEqual(spot(before, "hq"));
  expect(spot(after, "lab")).toBeDefined();
});

test("every station outside HQ gets a road to the anchor", () => {
  const built = layout({ actors: [actor("a", { station: "library" }), actor("b", { station: "lab" })] });
  expect(built.roads.map((r) => r.id).sort()).toEqual(["lab", "library"]);
  for (const road of built.roads) expect(road.d.startsWith("M ")).toBe(true);
});

test("a junction's shape comes from which sides carry road", () => {
  const sides = (open: string) => ({
    n: open.includes("n"),
    e: open.includes("e"),
    s: open.includes("s"),
    w: open.includes("w"),
  });
  expect(roadKind(sides(""))).toBe("end");
  expect(roadKind(sides("n"))).toBe("end");
  expect(roadKind(sides("ns"))).toBe("straight");
  expect(roadKind(sides("ew"))).toBe("straight");
  expect(roadKind(sides("ne"))).toBe("corner");
  expect(roadKind(sides("sw"))).toBe("corner");
  expect(roadKind(sides("nes"))).toBe("t");
  expect(roadKind(sides("nesw"))).toBe("cross");
});

test("the road network is the union of the cell paths, with connections read off it", () => {
  // One station due east of HQ: two cells, joined to each other and nothing else.
  const line = roadNetwork([{ x: 2, y: 0 }]);
  expect(line.map(cellKey)).toEqual(["2,0", "1,0", "0,0"]);
  expect(line.map((c) => c.kind)).toEqual(["end", "straight", "end"]);
  expect(line[0]!.sides).toEqual({ n: false, e: false, s: false, w: true });

  // A second station north of HQ turns the anchor into a corner where the two streets meet.
  const bend = roadNetwork([
    { x: 1, y: 0 },
    { x: 0, y: -1 },
  ]);
  const anchor = bend.find((c) => cellKey(c) === "0,0")!;
  expect(anchor.sides).toEqual({ n: true, e: true, s: false, w: false });
  expect(anchor.kind).toBe("corner");
});

test("shared road cells appear once and gain a T where a street branches", () => {
  // Both stations route along y = -1 before turning down to HQ, so that leg is shared.
  const net = roadNetwork([
    { x: 2, y: -1 },
    { x: 1, y: -1 },
  ]);
  expect(new Set(net.map(cellKey)).size).toBe(net.length);
  expect(net.map(cellKey).sort()).toEqual(["0,-1", "0,0", "1,-1", "2,-1"]);
  const branch = net.find((c) => cellKey(c) === "0,-1")!;
  expect(branch.kind).toBe("corner");
});

test("a cross appears where four streets meet at the anchor", () => {
  const net = roadNetwork([
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ]);
  const anchor = net.find((c) => cellKey(c) === "0,0")!;
  expect(anchor.kind).toBe("cross");
  expect(anchor.sides).toEqual({ n: true, e: true, s: true, w: true });
});

test("the drawn roads follow exactly the cells the network reports", () => {
  const built = layout({ actors: [actor("a", { station: "library" }), actor("b", { station: "lab" })] });
  const drawn = new Set(built.roads.flatMap((road) => road.d.match(/-?[\d.]+ -?[\d.]+/g) ?? []));
  const centers = new Set(
    built.roadCells.map(
      (c) =>
        `${(c.x + (built.side - 1) / 2) * CELL_SIZE.width + CELL_SIZE.width / 2} ${
          (c.y + (built.side - 1) / 2) * CELL_SIZE.height + CELL_SIZE.height / 2
        }`,
    ),
  );
  expect(drawn).toEqual(centers);
});

test("a walk follows the drawn streets end to end: old station → anchor → new station → the chip's spot", () => {
  const built = layout({ actors: [actor("a", { station: "library" }), actor("b", { station: "lab" })] });
  const target = { x: 300, y: 200 };
  const trip = built.travelPath("library", "lab", target)!;
  expect(trip.d.endsWith("L 300 200")).toBe(true);
  // library -> hq -> lab -> target: one continuous path, so exactly one move-to.
  expect(trip.d.match(/M /g)).toHaveLength(1);
  expect(built.travelPath("hq", "lab", target)!.d.match(/M /g)).toHaveLength(1);

  // Every point before the last is a road cell center (shifted by the unit's foot anchor): the
  // character walks the DRAWN street, not the plate — no straight flight and no flipped-L
  // shortcut through cells that have no road.
  const points = trip.d.match(/-?[\d.]+ -?[\d.]+/g)!;
  const onRoad = (x: number, y: number) => `${x - CHIP_FOOT.x} ${y - CHIP_FOOT.y}`;
  const roadCenters = new Set(
    built.roadCells.map((c) =>
      onRoad(
        (c.x + (built.side - 1) / 2) * CELL_SIZE.width + CELL_SIZE.width / 2,
        (c.y + (built.side - 1) / 2) * CELL_SIZE.height + CELL_SIZE.height / 2,
      ),
    ),
  );
  for (const point of points.slice(0, -1)) expect(roadCenters.has(point)).toBe(true);
  // It starts on the library's own cell, passes the anchor, and reaches the lab cell before the
  // final hop to the spot.
  const library = built.stations.find((s) => s.station === "library")!;
  const hq = built.stations.find((s) => s.station === "hq")!;
  const lab = built.stations.find((s) => s.station === "lab")!;
  expect(points[0]).toBe(onRoad(library.center.x, library.center.y));
  expect(points).toContain(onRoad(hq.center.x, hq.center.y));
  expect(points.at(-2)).toBe(onRoad(lab.center.x, lab.center.y));

  // A station this town never built has no route; the chip falls back to a plain move.
  expect(built.travelPath("review", "lab", target)).toBeNull();
});

test("walk pacing is per road cell hopped, capped for cross-town treks", () => {
  expect(travelFactor(1)).toBe(1); // standing start: never zero-duration
  expect(travelFactor(3)).toBe(2);
  expect(travelFactor(99)).toBe(6);
});

test("unfolded ended units stand at the memorial hall, apart from the idle crew at the lounge", () => {
  const built = layout({
    actors: [actor("a"), actor("b", { state: "ended" }), actor("c"), actor("d", { state: "ended" })],
  });
  // Four resting actors, under the fold: everyone stays an individual unit…
  expect(built.clusters).toEqual([]);
  expect(built.chips).toHaveLength(4);
  // …but the ended pair stands at the memorial spot (plate's foot), not back at the lounge.
  const endedChips = built.chips.filter((c) => c.actor.state === "ended");
  const idleChips = built.chips.filter((c) => c.actor.state === "idle");
  for (const chip of endedChips) {
    expect(chip.y).toBeGreaterThan(built.plate.height - 180);
    for (const idle of idleChips) expect(`${chip.x},${chip.y}`).not.toBe(`${idle.x},${idle.y}`);
  }
});

test("idle and ended fold into separate benches from five: lounge and memorial hall", () => {
  const folded = layout({
    actors: [
      ...Array.from({ length: 5 }, (_, i) => actor(`i${i}`)),
      ...Array.from({ length: 5 }, (_, i) => actor(`e${i}`, { state: "ended" })),
    ],
  });
  expect(folded.chips).toEqual([]);
  const idle = folded.clusters.find((c) => c.key === "idle")!;
  const ended = folded.clusters.find((c) => c.key === "ended")!;
  expect(idle.actors).toHaveLength(5);
  expect(idle.label).toBe("lounge");
  expect(ended.actors).toHaveLength(5);
  expect(ended.label).toBe("memorial hall");
  expect(`${idle.x},${idle.y}`).not.toBe(`${ended.x},${ended.y}`);
});

test("a single resting actor is not worth folding", () => {
  const solo = layout({ actors: [actor("solo")] });
  expect(solo.clusters).toEqual([]);
  expect(solo.chips.map((c) => c.actor.id)).toEqual(["solo"]);
});

test("up to four active actors hold a building's corners; a fifth folds the crew", () => {
  const crewOf = (n: number) =>
    layout({ actors: Array.from({ length: n }, (_, i) => actor(`a${i}`, { state: "working", station: "workshop" })) });

  const four = crewOf(4);
  expect(four.clusters).toEqual([]);
  expect(four.chips).toHaveLength(4);
  // 2×2 formation: two share the front row (same y, different x), two stand on the second row —
  // never four stacked floors.
  const ys = new Set(four.chips.map((c) => c.y));
  const xs = new Set(four.chips.map((c) => c.x));
  expect(ys.size).toBe(2);
  expect(xs.size).toBe(2);

  const five = crewOf(5);
  expect(five.chips).toEqual([]);
  const crew = five.clusters.find((c) => c.key === "station:workshop")!;
  expect(crew.kind).toBe("active");
  expect(crew.actors).toHaveLength(5);
});

test("under the fold everyone is an individual chip, whatever their state", () => {
  const built = layout({
    actors: [
      actor("worker", { state: "working", station: "workshop" }),
      actor("asker", { state: "waiting_user", station: "boss_desk" }),
      actor("flagged", { attentionIds: ["att-1"] }),
      actor("resting-1"),
      actor("resting-2"),
    ],
  });
  expect(built.clusters).toEqual([]);
  expect(built.chips.map((c) => c.actor.id)).toEqual(["worker", "asker", "flagged", "resting-1", "resting-2"]);
});

test("the folded idle crowd waits at the anchor when the town has no lounge", () => {
  const built = layout({
    actors: Array.from({ length: 5 }, (_, i) => actor(`a${i}`, { state: "idle", station: "workshop" })),
  });
  expect(built.stations.map((s) => s.station)).toEqual(["hq", "workshop"]);
  const hq = built.stations.find((s) => s.station === "hq")!;
  const idle = built.clusters.find((c) => c.key === "idle")!;
  expect(idle.x).toBeGreaterThanOrEqual(hq.x);
  expect(idle.y).toBeGreaterThanOrEqual(hq.y);
});

test("chips sharing a station never land on the same spot, clusters included", () => {
  const built = layout({
    actors: [
      ...Array.from({ length: 2 }, (_, i) => actor(`flagged-${i}`, { station: "hq", attentionIds: [`a${i}`] })),
      actor("resting-1"),
      actor("resting-2"),
    ],
  });
  const spots = [...built.chips.map((c) => `${c.x},${c.y}`), ...built.clusters.map((c) => `${c.x},${c.y}`)];
  expect(new Set(spots).size).toBe(spots.length);
});

test("a subagent links to its parent, but enters at the anchor like everyone else", () => {
  const built = layout({
    actors: [
      actor("child", { state: "working", station: "workshop", parentActorId: "parent" }),
      actor("parent", { state: "thinking", station: "library" }),
    ],
  });
  const child = built.chips.find((c) => c.actor.id === "child")!;
  const parent = built.chips.find((c) => c.actor.id === "parent")!;
  const hq = built.stations.find((s) => s.station === "hq")!;
  expect(built.links).toHaveLength(1);
  expect(built.links[0]).toMatchObject({ id: "child", active: true });
  // Spawn offset points back to the HQ cell, not to the parent chip: everyone arrives through HQ.
  for (const chip of [child, parent]) {
    expect(chip.x + chip.spawnDx).toBe(hq.center.x);
    expect(chip.y + chip.spawnDy).toBe(hq.center.y);
  }
});

test("no link when the parent is not on the stage, and no flow while the subagent rests", () => {
  const orphan = layout({ actors: [actor("child", { state: "working", parentActorId: "gone" })] });
  expect(orphan.links).toEqual([]);

  const quiet = layout({
    actors: [
      actor("child", { state: "waiting_user", station: "boss_desk", parentActorId: "parent" }),
      actor("parent", { state: "thinking", station: "library" }),
    ],
  });
  expect(quiet.links[0]?.active).toBe(false);
});

test("the fold keeps idle and ended as separate counts", () => {
  expect(restingBreakdown([actor("i1"), actor("i2"), actor("e1", { state: "ended" })])).toEqual([
    { state: "idle", count: 2 },
    { state: "ended", count: 1 },
  ]);
});
