import { expect, test } from "vitest";

import type { ActorView } from "#contracts/world.js";

import { layoutDistrict, restingBreakdown } from "./district-layout";

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

test("two or more resting actors fold into one cluster", () => {
  const layout = layoutDistrict([actor("a"), actor("b", { state: "ended" }), actor("c")], false);
  expect(layout.chips).toEqual([]);
  expect(layout.cluster?.folded).toBe(true);
  expect(layout.cluster?.actors.map((a) => a.id)).toEqual(["a", "b", "c"]);
});

test("a single resting actor is not worth folding", () => {
  const layout = layoutDistrict([actor("solo")], false);
  expect(layout.cluster).toBeNull();
  expect(layout.chips.map((c) => c.actor.id)).toEqual(["solo"]);
});

test("expanding keeps the cluster control but places every actor", () => {
  const actors = [actor("a"), actor("b"), actor("c")];
  const layout = layoutDistrict(actors, true);
  expect(layout.chips.map((c) => c.actor.id)).toEqual(["a", "b", "c"]);
  expect(layout.cluster?.folded).toBe(false);
});

test("active and needs-you actors are never folded, nor is an idle actor holding attention", () => {
  const actors = [
    actor("worker", { state: "working", station: "workshop" }),
    actor("asker", { state: "waiting_user", station: "boss_desk" }),
    actor("flagged", { attentionIds: ["att-1"] }),
    actor("resting-1"),
    actor("resting-2"),
  ];
  const layout = layoutDistrict(actors, false);
  expect(layout.chips.map((c) => c.actor.id)).toEqual(["worker", "asker", "flagged"]);
  expect(layout.cluster?.actors.map((a) => a.id)).toEqual(["resting-1", "resting-2"]);
});

test("chips sharing a station never land on the same spot, cluster included", () => {
  const actors = Array.from({ length: 8 }, (_, i) => actor(`flagged-${i}`, { attentionIds: [`a${i}`] })).concat(
    actor("resting-1"),
    actor("resting-2"),
  );
  const layout = layoutDistrict(actors, true);
  const spots = [...layout.chips.map((c) => `${c.x},${c.y}`), `${layout.cluster!.x},${layout.cluster!.y}`];
  expect(new Set(spots).size).toBe(spots.length);
});

test("a crowded station wraps into columns instead of growing past its plot", () => {
  const actors = Array.from({ length: 5 }, (_, i) => actor(`a${i}`, { attentionIds: [`att${i}`] }));
  const layout = layoutDistrict(actors, false);
  const first = layout.chips[0]!;
  expect(layout.chips.map((c) => c.y - first.y)).toEqual([0, 44, 0, 44, 0]);
  expect(layout.chips.map((c) => c.x - first.x)).toEqual([0, 0, 120, 120, 240]);
});

test("the fold keeps idle and ended as separate counts", () => {
  const actors = [actor("i1"), actor("i2"), actor("e1", { state: "ended" })];
  expect(restingBreakdown(actors)).toEqual([
    { state: "idle", count: 2 },
    { state: "ended", count: 1 },
  ]);
  expect(restingBreakdown([actor("e", { state: "ended" })])).toEqual([{ state: "ended", count: 1 }]);
});

test("a subagent links to its parent and remembers where to spawn from", () => {
  const actors = [
    actor("child", { state: "working", station: "workshop", parentActorId: "parent" }),
    actor("parent", { state: "thinking", station: "library" }),
  ];
  const layout = layoutDistrict(actors, false);
  const child = layout.chips.find((c) => c.actor.id === "child")!;
  const parent = layout.chips.find((c) => c.actor.id === "parent")!;
  expect(layout.links).toHaveLength(1);
  expect(layout.links[0]).toMatchObject({ id: "child", active: true });
  expect(child.x + child.spawnDx).toBe(parent.x);
  expect(child.y + child.spawnDy).toBe(parent.y);
});

test("no link when the parent is not on the stage, and no flow while the subagent rests", () => {
  const orphan = layoutDistrict([actor("child", { state: "working", parentActorId: "gone" })], false);
  expect(orphan.links).toEqual([]);
  expect(orphan.chips[0]?.spawnDx).toBe(0);

  const quiet = layoutDistrict(
    [
      actor("child", { state: "waiting_user", station: "boss_desk", parentActorId: "parent" }),
      actor("parent", { state: "thinking", station: "library" }),
    ],
    false,
  );
  expect(quiet.links[0]?.active).toBe(false);
});
