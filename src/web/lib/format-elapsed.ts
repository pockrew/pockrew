const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** HH:MM in the viewer's own locale — an absolute time never implies "currently happening". */
export const formatClockTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * Coarse, human time for glanceable lists (warehouse deliveries). Pure — takes `now` instead of
 * reading the clock, so callers pass `WorldState.generatedAt` and renders stay deterministic.
 *
 * `now` can go stale: the server suppresses patches that would only bump `generatedAt`, so a
 * receipt landing just before the last real patch computes a sub-minute delta that then never
 * advances while nothing else changes — "just now" would keep claiming currency hours later. The
 * smallest bucket is exactly the one reached by that smallest, easiest-to-go-stale delta, so it
 * renders an absolute clock time instead of a relative claim; the coarser buckets stay relative
 * since a little added staleness doesn't flip "3h ago" into a false claim of "right now".
 */
export const formatElapsed = (occurredAt: number, now: number): string => {
  const diff = Math.max(0, now - occurredAt);
  if (diff < MIN) return formatClockTime(occurredAt);
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  return `${Math.floor(diff / DAY)}d ago`;
};
