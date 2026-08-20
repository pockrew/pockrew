// ❄️ FROZEN — repo owner must approve changes. Stop and propose a diff instead of editing.
// Approved by owner 2026-08-20 (M3): SSE message shape shared by server and web.

import type { WorldState } from "./world.js";

/** Replace one top-level WorldState collection wholesale.
 *  Spec: patches start as replace-by-key; optimize later. */
export type WorldPatchOp = {
  [K in keyof WorldState]: { key: K; value: WorldState[K] };
}[keyof WorldState];

export type StreamMessage = { type: "snapshot"; world: WorldState } | { type: "patch"; ops: WorldPatchOp[] };
