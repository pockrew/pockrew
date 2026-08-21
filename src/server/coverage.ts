import type { AgentEvent } from "#contracts/events.js";
import type { WorldState } from "#contracts/world.js";
import type { Store } from "#core/store/store.js";

/** app_state key: wall-clock heartbeat written by cli.ts on startup, on clean shutdown, and
 *  every 30s while running — comparing against the last *stored event* would fake an outage
 *  for a daemon that was up but idle (no events) in between. */
export const HEARTBEAT_KEY = "daemon:lastAliveAt";

// Blind-window threshold (spec gives no number): a gap this long since the last heartbeat
// means the daemon was very likely not running to observe anything in between.
const BLIND_WINDOW_MS = 60_000;

// Both events key their dedupeKey on the heartbeat ts (not each event's own occurredAt) so the
// pair is atomic under INSERT OR IGNORE: a crash between the two inserts leaves a retryable gap
// instead of an unpairable orphan once the daemon comes back with a new heartbeat.
const daemonEvent = (
  kind: "coverage_lost" | "coverage_restored",
  last: number,
  occurredAt: number,
  summary: string,
): AgentEvent => ({
  id: `daemon:${kind}:${last}`,
  dedupeKey: `daemon:${kind}:${last}`,
  occurredAt,
  observedAt: occurredAt,
  // daemon ingests only claude hooks today; per-source coverage lands when codex tailing does.
  source: "claude",
  // a measured gap, not a verified outcome — nothing proves what did or didn't happen in it,
  // so this stays "inferred" rather than claiming a verified label it hasn't earned (AGENTS §7).
  confidence: "inferred",
  projectId: "daemon",
  sessionId: "daemon",
  actorId: "daemon",
  kind,
  summary,
});

/**
 * Daemon honesty (spec "Daemon honesty"): compare the last heartbeat against `now`. A real gap
 * past the blind window records coverage_lost at the last heartbeat and coverage_restored at
 * `now`, so the Shift Report can say "I was not running" instead of silently rendering the gap
 * as "nothing happened". No heartbeat yet (first run) means nothing to compare against — never
 * fake a blind window.
 */
/** No live Codex tailer runs yet (M0 decision: basic adapter, watching lands later). */
const CODEX_OFFLINE = "codex rollout tailing is not running — Claude Code sessions only for now";
const CLAUDE_OFFLINE = "no Claude events received yet — run: pockrew setup, then restart your sessions";

/**
 * Per-source coverage rows for `WorldState`, from real signals only (AGENTS §7): a failing store
 * write, an unmatched `coverage_lost`, or simply nothing received from that source. "healthy"
 * requires events actually arriving — never a default.
 */
export const sourceCoverage = (events: AgentEvent[], storeFailure?: string): WorldState["coverage"] => {
  const sources: Array<WorldState["coverage"][number]["source"]> = ["claude", "codex"];
  return sources.map((source) => {
    if (storeFailure !== undefined) return { source, status: "degraded", message: storeFailure };
    const own = events.filter((e) => e.source === source);
    const lastGap = own.filter((e) => e.kind === "coverage_lost" || e.kind === "coverage_restored").at(-1);
    if (lastGap?.kind === "coverage_lost") {
      return { source, status: "degraded", message: lastGap.summary ?? "daemon coverage lost — blind window open" };
    }
    if (own.length === 0) {
      return { source, status: "offline", message: source === "codex" ? CODEX_OFFLINE : CLAUDE_OFFLINE };
    }
    return { source, status: "healthy" };
  });
};

export const checkDaemonCoverage = (store: Store, now: number): void => {
  const raw = store.getAppState(HEARTBEAT_KEY);
  if (raw === undefined) return;
  const last = Number(raw);
  if (!Number.isFinite(last)) return; // corrupt/garbage heartbeat value — never guess a gap from it
  const gap = now - last;
  if (gap <= BLIND_WINDOW_MS) return;
  const window = `${Math.round(gap / 1000)}s`;
  store.insertEvent(daemonEvent("coverage_lost", last, last, `Daemon coverage lost — blind window starts (${window})`));
  store.insertEvent(
    daemonEvent("coverage_restored", last, now, `Daemon coverage restored after a ${window} blind window`),
  );
};
