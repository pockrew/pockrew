import { expect, test } from "vitest";

import type { WorldPatchOp } from "#contracts/stream.js";

import { mockWorld } from "../mock/world";
import { applyPatchOps } from "./apply-patch";

test("apply-patch replaces a single top-level key, leaving the rest untouched", () => {
  const world = structuredClone(mockWorld);
  const ops: WorldPatchOp[] = [{ key: "milestones", value: [] }];

  applyPatchOps(world, ops);

  expect(world.milestones).toEqual([]);
  expect(world.actors).toEqual(mockWorld.actors);
  expect(world.projects).toEqual(mockWorld.projects);
});

test("apply-patch applies multiple ops from a snapshot in order", () => {
  const world = structuredClone(mockWorld);
  const newAttention = [...mockWorld.attention, { ...mockWorld.attention[0]!, id: "att-new" }];
  const ops: WorldPatchOp[] = [
    { key: "attention", value: newAttention },
    { key: "generatedAt", value: mockWorld.generatedAt + 1_000 },
  ];

  applyPatchOps(world, ops);

  expect(world.attention).toEqual(newAttention);
  expect(world.generatedAt).toBe(mockWorld.generatedAt + 1_000);
});
