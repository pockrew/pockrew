import type { ActorView } from "#contracts/world.js";

import { STATION_POS, STATIONS } from "./world-meta";

/**
 * Placement of actors inside one district stage: which chip sits where, which resting actors fold
 * into the idle cluster, and where the parent-to-subagent links run. Pure, so the split is testable
 * without a DOM.
 */

/** Vertical pitch of chips stacked in the same station — a chip is a 40px minimum target. */
const CHIP_PITCH = 44;
const CHIP_INSET_X = 6;
const CHIP_INSET_Y = 34;
/** A station holds two chips before the stack wraps into a second column, so an expanded crowd
 *  stays inside its own plot instead of growing into the station below.
 *  ponytail: columns run off the stage past ~4 per station; give the stage a scale factor if a
 *  real world ever crowds one station that hard. */
const ROWS_PER_COLUMN = 2;
const COLUMN_PITCH = 120;
/** Where a relationship link attaches to a chip: left edge, mid height. */
const ANCHOR_DX = 10;
const ANCHOR_DY = 15;
/** One resting actor is not a stack — folding starts to pay off at two. */
const CLUSTER_MIN = 2;

const RESTING_STATES: ReadonlySet<ActorView["state"]> = new Set(["idle", "ended"]);
/** A link only flows while the subagent is actually doing something. */
const FLOWING_STATES: ReadonlySet<ActorView["state"]> = new Set(["starting", "thinking", "working"]);

export type ChipPlacement = {
  actor: ActorView;
  x: number;
  y: number;
  /** Offset back to the parent chip, so a spawning subagent animates out of it. Zero when orphan. */
  spawnDx: number;
  spawnDy: number;
};

export type ChipLink = { id: string; x1: number; y1: number; x2: number; y2: number; active: boolean };

export type DistrictLayout = {
  chips: ChipPlacement[];
  links: ChipLink[];
  /** Null when there is nothing worth folding. `folded` is false while the cluster is expanded. */
  cluster: { x: number; y: number; actors: ActorView[]; folded: boolean } | null;
};

/** An idle actor still holding an open attention item stays visible — folding it would hide work. */
export const isResting = (actor: ActorView): boolean =>
  RESTING_STATES.has(actor.state) && actor.attentionIds.length === 0;

/**
 * Count per resting state, in precedence order, dropping empty ones. The fold label reports
 * "2 idle · 3 ended" instead of merging two different states into one word (rules/react.md: status
 * is icon + label + colour, and idle is not ended).
 */
export const restingBreakdown = (actors: readonly ActorView[]): Array<{ state: ActorView["state"]; count: number }> =>
  [...RESTING_STATES]
    .map((state) => ({ state, count: actors.filter((a) => a.state === state).length }))
    .filter((group) => group.count > 0);

export const layoutDistrict = (actors: readonly ActorView[], expanded: boolean): DistrictLayout => {
  const resting = actors.filter(isResting);
  const clusterable = resting.length >= CLUSTER_MIN;
  const hidden = new Set(clusterable && !expanded ? resting.map((a) => a.id) : []);

  const taken = new Map<ActorView["station"], number>();
  const nextSlot = (station: ActorView["station"]) => {
    const slot = taken.get(station) ?? 0;
    taken.set(station, slot + 1);
    const pos = STATION_POS.get(station) ?? STATIONS[0]!;
    return {
      x: pos.x + CHIP_INSET_X + Math.floor(slot / ROWS_PER_COLUMN) * COLUMN_PITCH,
      y: pos.y + CHIP_INSET_Y + (slot % ROWS_PER_COLUMN) * CHIP_PITCH,
    };
  };

  const placed = new Map<string, { x: number; y: number }>();
  const chips: ChipPlacement[] = [];
  for (const actor of actors) {
    if (hidden.has(actor.id)) continue;
    const at = nextSlot(actor.station);
    placed.set(actor.id, at);
    chips.push({ actor, x: at.x, y: at.y, spawnDx: 0, spawnDy: 0 });
  }

  // Second pass: a parent can appear after its child in the actor list.
  const links: ChipLink[] = [];
  for (const chip of chips) {
    const parentId = chip.actor.parentActorId;
    const parent = parentId === undefined ? undefined : placed.get(parentId);
    if (!parent) continue;
    chip.spawnDx = parent.x - chip.x;
    chip.spawnDy = parent.y - chip.y;
    links.push({
      id: chip.actor.id,
      x1: parent.x + ANCHOR_DX,
      y1: parent.y + ANCHOR_DY,
      x2: chip.x + ANCHOR_DX,
      y2: chip.y + ANCHOR_DY,
      active: FLOWING_STATES.has(chip.actor.state),
    });
  }

  // The cluster takes the next free lounge slot: no signal maps to the lounge (docs/spec.md).
  const cluster = clusterable ? { ...nextSlot("lounge"), actors: resting, folded: !expanded } : null;
  return { chips, links, cluster };
};
