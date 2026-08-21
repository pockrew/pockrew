import type { AgentEvent, Confidence } from "#contracts/events.js";
import type { ActorState, ActorView } from "#contracts/world.js";

export type ActorSnapshot = Pick<
  ActorView,
  | "id"
  | "projectId"
  | "sessionId"
  | "source"
  | "state"
  | "stateConfidence"
  | "parentActorId"
  | "startedAt"
  | "updatedAt"
>;

export type ReduceTimers = {
  thinkingAfterMs: number;
  idleAfterMs: number;
  completedHoldMs: number;
  endedHoldMs: number;
  activityWindowMs: number;
};

// activityWindowMs is our own default (spec leaves the value open): ten minutes with no
// completion for one open activity is treated as lost track of, not still running.
export const defaultTimers: ReduceTimers = {
  thinkingAfterMs: 45_000,
  idleAfterMs: 60_000,
  completedHoldMs: 8_000,
  endedHoldMs: 10_000,
  activityWindowMs: 600_000,
};

/** Spread helper: include an optional property only when it has a value (exactOptionalPropertyTypes). */
const opt = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } => {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
};

/**
 * Per-actor accumulator built by replaying that actor's events in order. Tracks only the
 * open/closed signals the state machine needs — not a copy of every event.
 */
type Acc = {
  id: string;
  projectId: string;
  sessionId: string;
  source: AgentEvent["source"];
  parentActorId?: string;
  startedAt: number;
  lastEventAt: number;
  /** Last event confidence, excluding process_alive — used when a state is "still" an event's state. */
  lastEventConfidence: Confidence;
  /** Timestamp of the last non-heartbeat signal; process_alive never counts as a signal. */
  lastSignalAt: number;
  /** True until any event beyond session_started/subagent_started has been seen. */
  sawOnlyStart: boolean;
  endedAt?: number;
  endedConfidence?: Confidence;
  /** Open since the last prompt_submitted; cleared by task_completed or a turn_stop activity. */
  turnOpenSince?: number | undefined;
  /** Open since the last activity_started; cleared by its matching completed/failed. One at a time
   *  (Claude's PreToolUse/PostToolUse pairs run serially per actor) — concurrent tool calls are out
   *  of scope for M2. */
  activityOpenSince?: number | undefined;
  activityConfidence?: Confidence | undefined;
  /** Set by activity_failed; cleared by the next activity_started/activity_completed (recovery). */
  blockedSince?: number | undefined;
  blockedConfidence?: Confidence | undefined;
  /** Last task_completed / turn_stop / subagent_completed signal. */
  completedAt?: number | undefined;
  completedConfidence?: Confidence | undefined;
  /** Open since attention_requested; cleared by attention_resolved or any later activity signal. */
  attentionOpenSince?: number | undefined;
  attentionConfidence?: Confidence | undefined;
  lastProcessAliveAt?: number;
};

// Baseline for an actor's first-seen event; applyEvent still runs on it below so a first
// event other than session_started (e.g. missing SessionStart coverage) sets its own signals.
const baseAcc = (e: AgentEvent): Acc => ({
  id: e.actorId,
  projectId: e.projectId,
  sessionId: e.sessionId,
  source: e.source,
  startedAt: e.occurredAt,
  lastEventAt: e.occurredAt,
  lastEventConfidence: e.confidence,
  lastSignalAt: e.occurredAt,
  sawOnlyStart: true,
  ...opt("parentActorId", e.parentActorId),
});

const isTurnStop = (e: AgentEvent): boolean => e.kind === "activity_completed" && e.activity?.operation === "turn_stop";

const applyEvent = (acc: Acc, e: AgentEvent): Acc => {
  acc.lastEventAt = e.occurredAt;
  if (e.parentActorId !== undefined) acc.parentActorId = e.parentActorId;

  if (e.kind === "process_alive") {
    acc.lastProcessAliveAt = e.occurredAt;
    return acc; // heartbeat only, never a signal
  }

  acc.lastSignalAt = e.occurredAt;
  acc.lastEventConfidence = e.confidence;
  if (e.kind !== "session_started" && e.kind !== "subagent_started") acc.sawOnlyStart = false;

  switch (e.kind) {
    case "session_started":
    case "subagent_started":
      break;
    case "session_ended":
      acc.endedAt = e.occurredAt;
      acc.endedConfidence = e.confidence;
      break;
    case "prompt_submitted":
      acc.turnOpenSince = e.occurredAt;
      acc.completedAt = undefined;
      acc.completedConfidence = undefined;
      break;
    case "activity_started":
      acc.activityOpenSince = e.occurredAt;
      acc.activityConfidence = e.confidence;
      acc.blockedSince = undefined;
      acc.blockedConfidence = undefined;
      if (acc.attentionOpenSince !== undefined && e.occurredAt > acc.attentionOpenSince) {
        acc.attentionOpenSince = undefined;
        acc.attentionConfidence = undefined;
      }
      break;
    case "activity_completed":
      acc.activityOpenSince = undefined;
      acc.activityConfidence = undefined;
      acc.blockedSince = undefined;
      acc.blockedConfidence = undefined;
      if (acc.attentionOpenSince !== undefined && e.occurredAt > acc.attentionOpenSince) {
        acc.attentionOpenSince = undefined;
        acc.attentionConfidence = undefined;
      }
      if (isTurnStop(e)) {
        acc.turnOpenSince = undefined;
        acc.completedAt = e.occurredAt;
        acc.completedConfidence = e.confidence;
      }
      break;
    case "activity_failed":
      acc.activityOpenSince = undefined;
      acc.activityConfidence = undefined;
      acc.blockedSince = e.occurredAt;
      acc.blockedConfidence = e.confidence;
      break;
    case "task_completed":
      acc.turnOpenSince = undefined;
      acc.completedAt = e.occurredAt;
      acc.completedConfidence = e.confidence;
      break;
    case "subagent_completed":
      // Kind "subagent_completed" (SubagentStop) always targets the subagent's own actor
      // (normalize.ts sets actorId = agent_id for it) — unlike a main session, a subagent gets no
      // separate session_ended signal to wait for; this *is* the end signal. Mark it terminal the
      // same way session_ended does, so the idle decay below can never apply to it (spec: idle/
      // starting describe a still-open session only — a stopped subagent is never "idle").
      acc.turnOpenSince = undefined;
      acc.completedAt = e.occurredAt;
      acc.completedConfidence = e.confidence;
      acc.endedAt = e.occurredAt;
      acc.endedConfidence = e.confidence;
      break;
    case "attention_requested":
      acc.attentionOpenSince = e.occurredAt;
      acc.attentionConfidence = e.confidence;
      break;
    case "attention_resolved":
      acc.attentionOpenSince = undefined;
      acc.attentionConfidence = undefined;
      break;
    case "file_touched":
    case "model_started":
      break; // signals that keep the actor alive but carry no state transition of their own
    case "coverage_lost":
    case "coverage_restored":
      break; // unreachable: reduceActors filters these out before folding (world-scoped, not actor signals)
  }
  return acc;
};

type Derived = { state: ActorState; confidence: Confidence };

/** Working/thinking/completed/idle/starting/unknown, ignoring session_ended entirely. */
const deriveCandidate = (acc: Acc, now: number, timers: ReduceTimers): Derived => {
  if (acc.activityOpenSince !== undefined) {
    if (now - acc.activityOpenSince <= timers.activityWindowMs) {
      return { state: "working", confidence: acc.activityConfidence ?? "observed" };
    }
    return { state: "unknown", confidence: "inferred" }; // past its window — never assume completion
  }
  if (acc.turnOpenSince !== undefined) {
    const elapsed = now - acc.lastSignalAt;
    if (elapsed < timers.thinkingAfterMs) {
      return { state: "working", confidence: acc.lastEventConfidence };
    }
    // A process_alive that arrived after the session already ended (legit under out-of-order
    // arrival) can't honestly assert the process is still alive — ignore it for "thinking".
    if (
      acc.lastProcessAliveAt !== undefined &&
      acc.lastProcessAliveAt > acc.lastSignalAt &&
      (acc.endedAt === undefined || acc.lastProcessAliveAt <= acc.endedAt)
    ) {
      return { state: "thinking", confidence: "inferred" };
    }
    return { state: "unknown", confidence: "inferred" };
  }
  if (acc.completedAt !== undefined) {
    if (now - acc.completedAt <= timers.completedHoldMs) {
      return { state: "completed", confidence: acc.completedConfidence ?? "observed" };
    }
    return { state: "idle", confidence: "inferred" }; // hold expired: decays straight to idle
  }
  if (acc.sawOnlyStart) {
    if (now - acc.lastSignalAt >= timers.idleAfterMs) return { state: "idle", confidence: "inferred" };
    return { state: "starting", confidence: acc.lastEventConfidence };
  }
  if (now - acc.lastSignalAt >= timers.idleAfterMs) {
    return { state: "idle", confidence: "inferred" };
  }
  // Recently active, no open turn/activity, nothing to celebrate or decay yet.
  return { state: "working", confidence: acc.lastEventConfidence };
};

/** Highest-precedence state that currently holds, evaluated at `now`. See docs/spec.md "Actor lifecycle". */
const finalize = (acc: Acc, now: number, timers: ReduceTimers): Derived => {
  if (acc.attentionOpenSince !== undefined) {
    return { state: "waiting_user", confidence: acc.attentionConfidence ?? "observed" };
  }
  if (acc.blockedSince !== undefined) {
    return { state: "blocked", confidence: acc.blockedConfidence ?? "observed" };
  }

  const candidate = deriveCandidate(acc, now, timers);

  // working/thinking/completed all outrank "ended" (spec precedence) — an actor caught mid-activity
  // or still celebrating a completion when the session ended stays visible as that state. Idle and
  // starting are defined for a *live* session and unknown is ended's only inferior, so all three lose
  // to "ended" once the session has actually ended; the hold window is a renderer concern only.
  if (
    acc.endedAt !== undefined &&
    (candidate.state === "idle" || candidate.state === "starting" || candidate.state === "unknown")
  ) {
    return { state: "ended", confidence: acc.endedConfidence ?? "observed" };
  }
  return candidate;
};

const toSnapshot = (acc: Acc, now: number, timers: ReduceTimers): ActorSnapshot => {
  const { state, confidence } = finalize(acc, now, timers);
  return {
    id: acc.id,
    projectId: acc.projectId,
    sessionId: acc.sessionId,
    source: acc.source,
    state,
    stateConfidence: confidence,
    startedAt: acc.startedAt,
    updatedAt: acc.lastEventAt,
    ...opt("parentActorId", acc.parentActorId),
  };
};

export const reduceActors = (
  events: AgentEvent[],
  now: number,
  timers: ReduceTimers = defaultTimers,
): ActorSnapshot[] => {
  const seen = new Set<string>();
  const ordered = events
    // coverage_lost/coverage_restored are world-scoped daemon signals (spec: Shift Report reads
    // them directly), not actor activity — folding them in would spawn a fake "daemon" actor.
    .filter((e) => e.kind !== "coverage_lost" && e.kind !== "coverage_restored")
    .filter((e) => (seen.has(e.dedupeKey) ? false : (seen.add(e.dedupeKey), true)))
    .slice()
    .sort((a, b) => a.occurredAt - b.occurredAt);

  const byActor = new Map<string, Acc>();
  for (const e of ordered) {
    const acc = byActor.get(e.actorId) ?? baseAcc(e);
    byActor.set(e.actorId, applyEvent(acc, e));
  }

  return [...byActor.values()].map((acc) => toSnapshot(acc, now, timers));
};
