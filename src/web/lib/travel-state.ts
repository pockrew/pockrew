import type { ActorView, Station } from "#contracts/world.js";

import { isResting, type Travel } from "./district-layout";

/**
 * Whether a chip is walking, and from where the next walk is measured.
 *
 * Kept out of the component on purpose: the DOM glue in `actor-chip` is two effects and a timer,
 * while every decision about "is this a new trip" lives here, where it can be tested without a DOM.
 */
export type TravelState = {
  /** The station the chip is standing at (or heading to) — the origin of the next trip. */
  at: Station;
  /** The road being walked right now, or null while resting. */
  travel: Travel | null;
};

export const restingAt = (at: Station): TravelState => ({ at, travel: null });

/**
 * Did this character actually turn up while the user was watching? Only an arrival earns the walk out
 * of HQ; every other way a chip can mount has nothing behind it, and animating those would be
 * invented motion (docs/spec.md: never fake a signal — no event, no movement).
 *
 * Two of them are easy to hit and both used to parade a whole crew out of HQ:
 *  - a reload or a reconnect remounts characters that have been working for hours;
 *  - unfolding the idle cluster reveals resting chips on a pure UI gesture, no data change at all.
 *
 * `startedAt` after the first snapshot the tab ever saw is what makes an arrival real. A resting
 * actor is never one, which is also what covers the fold: everything it can hide is resting.
 */
export const isArrival = (
  actor: Pick<ActorView, "startedAt" | "state" | "attentionIds">,
  firstSnapshotAt: number,
): boolean => actor.startedAt > firstSnapshotAt && !isResting(actor);

/**
 * Where a chip begins life. An arrival starts on the HQ cell already walking the road to its station;
 * anyone else simply stands where they already are.
 */
export const entryTrip = (station: Station, arrival: boolean, route: (from: Station) => Travel | null): TravelState =>
  arrival ? nextTravel(restingAt("hq"), station, route) : restingAt(station);

/**
 * Next state for a (possibly unchanged) station. Returns the **same object** when nothing moved, so
 * an effect keyed on the state does not re-run — that is what keeps the walk backstop timer from
 * being cleared and never re-armed by an unrelated re-render.
 *
 * `route` is only asked for a road when the station really changed; a null road means the origin
 * station is no longer on the plate, so the chip falls back to the plain transform transition.
 */
export const nextTravel = (
  previous: TravelState,
  station: Station,
  route: (from: Station) => Travel | null,
): TravelState => (previous.at === station ? previous : { at: station, travel: route(previous.at) });

/** The walk ended (or the backstop fired): drop the road, keep the station. Same-object when resting. */
export const settleTravel = (previous: TravelState): TravelState =>
  previous.travel === null ? previous : { at: previous.at, travel: null };
