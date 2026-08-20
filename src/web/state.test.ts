import { expect, test } from "vitest";

import type { ConnectionStatus } from "@/lib/world-meta";

import { mockWorld } from "./mock/world";
import { reduceStreamData } from "./state";

// Raw strings, exactly as they'd arrive as an SSE `data:` payload — not StreamMessage objects —
// so this exercises the same JSON.parse + dispatch path the EventSource onmessage handler runs.
test("reduceStreamData: a snapshot then a patch reduce to the expected world", () => {
  const draft: { world: typeof mockWorld | null; connection: ConnectionStatus } = {
    world: null,
    connection: "connecting",
  };

  const snapshotRaw = JSON.stringify({ type: "snapshot", world: mockWorld });
  const wasSnapshot = reduceStreamData(draft, snapshotRaw);
  expect(wasSnapshot).toBe(true);
  expect(draft.connection).toBe("live");
  expect(draft.world).toEqual(mockWorld);

  const patchRaw = JSON.stringify({ type: "patch", ops: [{ key: "milestones", value: [] }] });
  const wasPatchSnapshot = reduceStreamData(draft, patchRaw);
  expect(wasPatchSnapshot).toBe(false);
  expect(draft.world?.milestones).toEqual([]);
  // Untouched keys survive the patch.
  expect(draft.world?.actors).toEqual(mockWorld.actors);
});

test("reduceStreamData: a patch before any snapshot is a no-op (no world to patch)", () => {
  const draft: { world: typeof mockWorld | null; connection: ConnectionStatus } = {
    world: null,
    connection: "connecting",
  };

  const patchRaw = JSON.stringify({ type: "patch", ops: [{ key: "milestones", value: [] }] });
  const wasSnapshot = reduceStreamData(draft, patchRaw);

  expect(wasSnapshot).toBe(false);
  expect(draft.world).toBeNull();
});
