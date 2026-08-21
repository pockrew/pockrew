import type { ShiftReport } from "#contracts/reports.js";

/**
 * Spec Return trigger 3: "on restart with new events since lastSeenAt" — the report opens itself
 * only when the window actually holds something. `needsYouNow` is current state (the attention
 * HUD already shows it live), so it never counts as window news on its own; `noVerifiedOutcome`
 * does — it is present exactly when agents were active in the window.
 */
export const reportHasNews = (r: ShiftReport): boolean =>
  r.shipped.length > 0 ||
  r.completedActivity.length > 0 ||
  r.changed.length > 0 ||
  r.problems.failures.length > 0 ||
  r.problems.errors.length > 0 ||
  r.problems.recoveries.length > 0 ||
  r.problems.blindWindows.length > 0 ||
  r.noVerifiedOutcome !== undefined;
