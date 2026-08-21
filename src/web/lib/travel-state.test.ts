import { expect, test } from "vitest";

import type { ActorView } from "#contracts/world.js";

import type { Travel } from "./district-layout";
import { entryTrip, isArrival, nextTravel, restingAt, settleTravel } from "./travel-state";

const road: Travel = { d: "M 0 0 L 10 10", factor: 1 };
const routeTo = (): Travel | null => road;
const noRoad = (): Travel | null => null;

/** The snapshot the tab opened on; anything started after it turned up while the user was watching. */
const FIRST_SNAPSHOT = 1_800_000_000_000;

const arriving = (over: Partial<ActorView> = {}): Pick<ActorView, "startedAt" | "state" | "attentionIds"> => ({
  startedAt: FIRST_SNAPSHOT + 1,
  state: "working",
  attentionIds: [],
  ...over,
});

test("a chip starts resting at its station", () => {
  expect(restingAt("hq")).toEqual({ at: "hq", travel: null });
});

test("only a character that turned up while watching counts as an arrival", () => {
  expect(isArrival(arriving(), FIRST_SNAPSHOT)).toBe(true);
});

test("the crew already there on the first snapshot never arrives again", () => {
  // The reload/reconnect case: hours-old actors remount and must not parade out of HQ.
  expect(isArrival(arriving({ startedAt: FIRST_SNAPSHOT - 60_000 }), FIRST_SNAPSHOT)).toBe(false);
  // Started exactly on the snapshot the tab opened with: it was already there, so it is not an arrival.
  expect(isArrival(arriving({ startedAt: FIRST_SNAPSHOT }), FIRST_SNAPSHOT)).toBe(false);
});

test("a resting character never arrives, so unfolding the idle cluster moves nobody", () => {
  // Everything the fold can hide is resting, so this one rule covers the whole UI-gesture case:
  // revealing a chip is not a data event and must not animate.
  for (const state of ["idle", "ended"] as const) {
    expect(isArrival(arriving({ state }), FIRST_SNAPSHOT)).toBe(false);
  }
  // An idle actor holding attention is not resting — it is on the plate either way, and a genuinely
  // new one still gets its entrance.
  expect(isArrival(arriving({ state: "idle", attentionIds: ["att-1"] }), FIRST_SNAPSHOT)).toBe(true);
});

test("an arrival enters at HQ and walks out; everyone else just stands where they are", () => {
  expect(entryTrip("lab", true, routeTo)).toEqual({ at: "lab", travel: road });
  expect(entryTrip("lab", false, routeTo)).toEqual({ at: "lab", travel: null });
  // An arrival posted at HQ has nowhere to walk, so it only pops in.
  expect(entryTrip("hq", true, routeTo)).toEqual({ at: "hq", travel: null });
  // No road out of HQ (a town that has not built one yet): the entrance degrades to standing there.
  expect(entryTrip("lab", true, noRoad)).toEqual({ at: "lab", travel: null });
});

test("a station change starts a walk on the road it is given", () => {
  expect(nextTravel(restingAt("hq"), "lab", routeTo)).toEqual({ at: "lab", travel: road });
});

test("the origin passed to the router is the station the chip came from", () => {
  const seen: string[] = [];
  nextTravel(restingAt("hq"), "lab", (from) => {
    seen.push(from);
    return road;
  });
  expect(seen).toEqual(["hq"]);
});

test("an unchanged station returns the same object, so an effect keyed on it does not re-run", () => {
  // The bug this guards: District rebuilds its layout every render, so the chip re-renders on
  // every world patch. A fresh object here would clear the walk backstop timer and never re-arm it,
  // leaving the chip data-moving forever.
  const walking = nextTravel(restingAt("hq"), "lab", routeTo);
  expect(nextTravel(walking, "lab", routeTo)).toBe(walking);
});

test("a station with no road still advances, without a walk", () => {
  expect(nextTravel(restingAt("hq"), "lab", noRoad)).toEqual({ at: "lab", travel: null });
});

test("chained moves measure from the previous station, not the original one", () => {
  const first = nextTravel(restingAt("hq"), "lab", routeTo);
  const seen: string[] = [];
  nextTravel(first, "review", (from) => {
    seen.push(from);
    return road;
  });
  expect(seen).toEqual(["lab"]);
});

test("settling drops the road and keeps the station", () => {
  const walking = nextTravel(restingAt("hq"), "lab", routeTo);
  expect(settleTravel(walking)).toEqual({ at: "lab", travel: null });
});

test("settling an already resting chip returns the same object, so no re-render loops", () => {
  const resting = restingAt("hq");
  expect(settleTravel(resting)).toBe(resting);
});

test("a move after settling walks again — a settled chip is not stuck", () => {
  const settled = settleTravel(nextTravel(restingAt("hq"), "lab", routeTo));
  expect(nextTravel(settled, "hq", routeTo)).toEqual({ at: "hq", travel: road });
});
