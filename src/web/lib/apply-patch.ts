import type { WorldPatchOp } from "#contracts/stream.js";
import type { WorldState } from "#contracts/world.js";

/** Replace one top-level key. Generic so the union `WorldPatchOp` type-checks against the assignment. */
const applyOp = <K extends keyof WorldState>(world: WorldState, op: { key: K; value: WorldState[K] }): void => {
  world[op.key] = op.value;
};

/**
 * Mutates `world` in place, replacing each patched key's value (replace-by-key, per stream.ts).
 * Works on a plain object or an Immer draft — the store calls this from inside `immer`'s producer.
 */
export const applyPatchOps = (world: WorldState, ops: readonly WorldPatchOp[]): void => {
  for (const op of ops) applyOp(world, op);
};
