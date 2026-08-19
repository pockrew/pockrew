import { create } from "zustand";

import type { WorldState } from "#contracts/world.js";

import { mockWorld } from "./mock/world";

type WorldStore = {
  world: WorldState | null;
  setWorld: (world: WorldState) => void;
  /** Stub: loads the mock fixture. SSE snapshot/patch lands in M3-server. */
  connect: () => void;
};

export const useWorldStore = create<WorldStore>((set) => ({
  world: null,
  setWorld: (world) => set({ world }),
  connect: () => set({ world: mockWorld }),
}));
