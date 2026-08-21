import { describe, expect, it } from "vitest";

import type { ShiftReport } from "#contracts/reports.js";

import { reportHasNews } from "./report-news";

const empty = (): ShiftReport => ({
  from: 0,
  to: 1_000,
  needsYouNow: [],
  shipped: [],
  completedActivity: [],
  changed: [],
  problems: { failures: [], errors: [], recoveries: [], blindWindows: [] },
  nextActions: [],
});

describe("reportHasNews", () => {
  it("an empty window is not news, even with live attention items", () => {
    expect(reportHasNews(empty())).toBe(false);
    const withAttention = {
      ...empty(),
      needsYouNow: [{ id: "a" }] as ShiftReport["needsYouNow"],
      nextActions: ["Approve or deny: x"],
    };
    expect(reportHasNews(withAttention)).toBe(false); // HUD already shows current state
  });

  it("window content of any section is news", () => {
    expect(reportHasNews({ ...empty(), changed: [{ projectId: "/p", files: ["a.ts"] }] })).toBe(true);
    expect(
      reportHasNews({
        ...empty(),
        problems: { failures: [], errors: [], recoveries: [], blindWindows: [{ from: 1, to: 2 }] },
      }),
    ).toBe(true);
    expect(
      reportHasNews({ ...empty(), noVerifiedOutcome: "Agents were active, but no verified outcome was captured." }),
    ).toBe(true);
  });
});
