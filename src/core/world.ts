import type { AgentEvent } from "#contracts/events.js";
import type { WorkReceipt } from "#contracts/receipts.js";
import type {
  ActivityCategory,
  ActivityView,
  ActorView,
  AttentionView,
  MilestoneView,
  ProjectView,
  ReceiptView,
  Station,
  WorldState,
} from "#contracts/world.js";
import { deriveAttention, type AttentionOverlay } from "#core/attention/attention.js";
import { deriveReceipts } from "#core/receipts/receipts.js";
import { defaultTimers, reduceActors, type ActorSnapshot } from "#core/reduce/reduce.js";

/**
 * AgentEvent[] → WorldState. Pure assembly: `now` and `coverage` are parameters, never read
 * from a clock or invented here (spec: "Unsupported renders as unknown"). Actor states come
 * from `reduceActors` and receipts from `deriveReceipts` — this module only projects them into
 * the view shapes the renderer consumes.
 */

/** Spec "World mapping": activity category → station. Exported so a caller placing stations on
 *  the persisted town grid (server/stream.ts) can tell which stations a project's *activities*
 *  imply without duplicating this map or reimplementing stationFor's precedence rules. */
export const STATION_BY_CATEGORY: Record<ActivityCategory, Station> = {
  research: "library",
  code: "workshop",
  terminal: "lab",
  review: "review",
  coordination: "hq",
};

/** Spec "World mapping": milestones trace back to verified receipt counts only. */
const MILESTONES: Array<{
  key: MilestoneView["key"];
  label: string;
  target: number;
  /** Set when the milestone counts one receipt kind instead of every verified receipt. */
  kind?: WorkReceipt["kind"];
}> = [
  { key: "first_delivery", label: "First delivery", target: 1 },
  { key: "workshop_1", label: "Workshop upgrade", target: 10 },
  { key: "workshop_2", label: "Workshop expansion", target: 50 },
  { key: "district_landmark", label: "District landmark", target: 200 },
  { key: "recovery_badge", label: "Recovery badge", target: 10, kind: "failure_recovered" },
];

/**
 * Verified *outcomes* — the only receipts a milestone may count. `test_failed`/`build_failed` are
 * verified evidence too (a real exit code), but a failure is not a delivery, and progression comes
 * from real outcomes only (spec principle 8).
 */
const MILESTONE_KINDS = new Set<WorkReceipt["kind"]>([
  "task_completed",
  "test_passed",
  "build_passed",
  "commit_created",
  "failure_recovered",
]);

/** Snapshot budget is 200 KB for 25 actors (spec "Budgets"); the inspector pages older ones. */
const RECENT_RECEIPT_LIMIT = 20;

/** How long an ended character lingers (at the memorial hall) before leaving the world. Its
 *  receipts stay in the warehouse forever — only the character walks off the map. */
const ENDED_LINGER_MS = 30 * 60_000;

/**
 * Actors the user actually witnessed doing something: any event beyond a lone SubagentStop.
 * Claude Code fires SubagentStop for internal background helpers (title generation etc. — a fresh
 * agent_id per turn, no SubagentStart, no activity; fixture M0 and live 2026-08-21 both show it),
 * and rendering those would grow a ghost crowd at the memorial hall on every message. Their
 * events stay stored; they just never become characters (spec: a character is a working agent).
 */
const witnessedActorIds = (events: AgentEvent[]): Set<string> => {
  const seen = new Set<string>();
  for (const e of events) if (e.kind !== "subagent_completed") seen.add(e.actorId);
  return seen;
};

/** Spread helper: include an optional property only when it has a value (exactOptionalPropertyTypes). */
const opt = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } => {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
};

const shortId = (id: string): string => (id.length > 8 ? id.slice(0, 8) : id);

const SOURCE_LABEL: Record<AgentEvent["source"], string> = { claude: "Claude", codex: "Codex" };

/** Display names truncate harder than the 160-char event/receipt summary (spec: world budgets). */
const DISPLAY_NAME_LIMIT = 48;

const truncateDisplayName = (text: string): string =>
  text.length > DISPLAY_NAME_LIMIT ? text.slice(0, DISPLAY_NAME_LIMIT - 1) + "…" : text;

/** A session's own latest user prompt — the real signal for what a main actor is on *now*. The
 *  latest (not the first) because a supervisor reads the current phase, and the first prompt the
 *  daemon saw is often mid-conversation for a session that predates it. */
const latestPromptFor = (ordered: AgentEvent[], actorId: string): string | undefined => {
  let latest: string | undefined;
  for (const e of ordered) {
    // Skip tag-like system injections (<task-notification>, <system-reminder>, …) — not a human
    // prompt. Skip-and-fallback only: never clean or reword the text (spec principle 10).
    if (e.actorId === actorId && e.kind === "prompt_submitted" && e.summary && !e.summary.startsWith("<")) {
      latest = e.summary;
    }
  }
  return latest;
};

/**
 * The parent's own Task/Agent spawn calls: normalize.ts carries the call's `description` as
 * `activity.operation` (the same slot bash uses for its command) and its full `prompt` as the
 * event summary — SubagentStart itself names no task. No id survives normalize to match a call to
 * the specific session it spawned, so either text is only trusted when the pairing can't be
 * wrong: exactly one spawn call and exactly one subagent for that parent. Two Task calls racing
 * ahead of two SubagentStarts can arrive in either order — guessing by position risks naming a
 * subagent after the wrong call, which is an invented relationship (AGENTS rule 7) — so anything
 * but a clean 1:1 falls back structurally.
 */
const spawnCallsFor = (
  ordered: AgentEvent[],
  parentActorId: string,
): Array<{ description?: string; prompt?: string }> =>
  ordered
    .filter(
      (e) =>
        e.actorId === parentActorId &&
        e.kind === "activity_started" &&
        (e.activity?.tool === "Task" || e.activity?.tool === "Agent"),
    )
    .map((e) => ({ ...opt("description", e.activity?.operation), ...opt("prompt", e.summary) }));

/** The real `agent_type` off this subagent's own SubagentStart (e.g. "general-purpose"), when
 *  the provider sent one — normalize.ts carries it in `summary`. */
const agentTypeFor = (ordered: AgentEvent[], actorId: string): string | undefined => {
  for (const e of ordered) if (e.actorId === actorId && e.kind === "subagent_started" && e.summary) return e.summary;
  return undefined;
};

// A label, not a signal: a main actor's name comes from its own session's latest prompt; a
// subagent's from the real description its Task/Agent spawn call carried, but only when that
// pairing is unambiguous — the same 1:1 rule gates `taskSummary`, the spawn call's full prompt.
// Nothing is ever invented or summarized — falling back to a structural label (honest agent_type
// + ordinal when the provider sent one, otherwise a bare ordinal), or the bare source+id form
// when no text exists at all (spec principle 10: unsupported renders as unknown).
const actorLabels = (
  snapshots: ActorSnapshot[],
  ordered: AgentEvent[],
): { names: Map<string, string>; taskSummaries: Map<string, string> } => {
  const bySpawnOrder = [...snapshots].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  const names = new Map<string, string>();
  const taskSummaries = new Map<string, string>();
  for (const a of bySpawnOrder) {
    if (a.parentActorId !== undefined) continue;
    const prompt = latestPromptFor(ordered, a.id);
    names.set(a.id, prompt ? truncateDisplayName(prompt) : `${SOURCE_LABEL[a.source]} ${shortId(a.sessionId)}`);
  }

  const subagentsByParent = new Map<string, ActorSnapshot[]>();
  for (const a of bySpawnOrder) {
    if (a.parentActorId === undefined) continue;
    const siblings = subagentsByParent.get(a.parentActorId) ?? [];
    siblings.push(a);
    subagentsByParent.set(a.parentActorId, siblings);
  }

  for (const [parentId, subagents] of subagentsByParent) {
    const calls = spawnCallsFor(ordered, parentId);
    const parentName = names.get(parentId) ?? `${SOURCE_LABEL[subagents[0]!.source]} ${shortId(parentId)}`;
    const unambiguous = calls.length === 1 && subagents.length === 1;
    subagents.forEach((a, i) => {
      if (unambiguous) {
        const call = calls[0]!;
        if (call.prompt !== undefined) taskSummaries.set(a.id, call.prompt); // already ≤160 upstream
        if (call.description !== undefined) {
          names.set(a.id, truncateDisplayName(call.description));
          return;
        }
      }
      const ordinal = i + 1;
      const agentType = agentTypeFor(ordered, a.id);
      const label = agentType ? `${agentType} #${ordinal}` : `Subagent ${ordinal}`;
      // The composed label, not just the parent fragment, is what can run past budget.
      names.set(a.id, truncateDisplayName(`${label} · ${parentName}`));
    });
  }
  return { names, taskSummaries };
};

const projectName = (projectId: string): string => projectId.split("/").filter(Boolean).pop() ?? projectId;

const activityView = (e: AgentEvent, status: ActivityView["status"]): ActivityView => ({
  id: `activity:${e.dedupeKey}`,
  actorId: e.actorId,
  projectId: e.projectId,
  category: e.activity?.category ?? "terminal",
  status,
  confidence: e.confidence,
  startedAt: e.occurredAt,
  ...opt("tool", e.activity?.tool),
  ...opt("operation", e.activity?.operation),
  ...opt("endedAt", status === "running" ? undefined : e.occurredAt),
});

/**
 * The activity each actor is on right now: the last activity event wins. One open activity per
 * actor, matched on tool — the same serial assumption reduce.ts documents, since concurrent tool
 * calls carry no correlation id on AgentEvent. An activity still open past the reducer's activity
 * window reads `unknown`, never a completion we never saw (spec principle 10).
 */
const currentActivities = (events: AgentEvent[], now: number): Map<string, ActivityView> => {
  const byActor = new Map<string, ActivityView>();
  for (const e of events) {
    if (e.kind === "activity_started") {
      byActor.set(e.actorId, activityView(e, "running"));
      continue;
    }
    if (e.kind !== "activity_completed" && e.kind !== "activity_failed") continue;
    const status = e.kind === "activity_completed" ? "completed" : "failed";
    const open = byActor.get(e.actorId);
    if (open?.status === "running" && open.tool === e.activity?.tool) {
      byActor.set(e.actorId, { ...open, status, confidence: e.confidence, endedAt: e.occurredAt });
      continue;
    }
    byActor.set(e.actorId, activityView(e, status));
  }
  // Same window and same verdict as reduceActors: the actor reads "unknown" too, so the pair
  // never disagrees about whether that tool call is still running.
  for (const [actorId, activity] of byActor) {
    if (activity.status === "running" && now - activity.startedAt > defaultTimers.activityWindowMs) {
      byActor.set(actorId, { ...activity, status: "unknown", confidence: "inferred" });
    }
  }
  return byActor;
};

/** "Still needing you" for counts and actor badges: open or acknowledged — a snoozed item is
 *  parked, so it must not keep a district glowing (mirrors src/web/lib/attention.ts). */
const needsUser = (item: AttentionView): boolean => item.status === "open" || item.status === "acknowledged";

const stationFor = (state: ActorView["state"], activity: ActivityView | undefined): Station => {
  if (state === "waiting_user") return "boss_desk"; // spec: waiting on the user → boss desk
  if (activity && (state === "working" || state === "thinking" || state === "blocked")) {
    return STATION_BY_CATEGORY[activity.category];
  }
  return "lounge"; // no current signal (spec: no signal → lounge)
};

const receiptView = (r: WorkReceipt, reviewedReceiptIds: ReadonlySet<string>): ReceiptView => ({
  id: r.id,
  projectId: r.projectId,
  actorId: r.actorId,
  kind: r.kind,
  title: r.title,
  confidence: r.confidence,
  occurredAt: r.occurredAt,
  // Summaries are truncated to 160 chars upstream in normalize/receipts, never re-cut here.
  ...opt("summary", r.summary),
  fileCount: r.files?.length ?? 0,
  // Real user signal only (M5): the receipt_mark_reviewed intent persists the id server-side.
  // Receipt ids are stable across re-derivation (receipt:${kind}:${dedupeKey}), so the flag
  // survives every rebuild. Evidence itself is immutable — this flips a flag, nothing else.
  reviewed: reviewedReceiptIds.has(r.id),
});

const milestonesFor = (projectId: string, receipts: WorkReceipt[]): MilestoneView[] => {
  const outcomes = receipts.filter((r) => r.confidence === "verified" && MILESTONE_KINDS.has(r.kind));
  const recoveries = outcomes.filter((r) => r.kind === "failure_recovered");
  return MILESTONES.map((m) => {
    const pool = m.kind === undefined ? outcomes : recoveries;
    return {
      key: m.key,
      projectId,
      label: m.label,
      current: pool.length,
      target: m.target,
      // Achieved when the target-th verified outcome landed; receipts arrive sorted ascending.
      ...opt("achievedAt", pool[m.target - 1]?.occurredAt),
    };
  });
};

export const assembleWorld = (
  events: AgentEvent[],
  now: number,
  coverage: WorldState["coverage"],
  attentionOverlays: ReadonlyMap<string, AttentionOverlay> = new Map(),
  reviewedReceiptIds: ReadonlySet<string> = new Set(),
): WorldState => {
  const seen = new Set<string>();
  const ordered = events
    .filter((e) => (seen.has(e.dedupeKey) ? false : (seen.add(e.dedupeKey), true)))
    .sort((a, b) => a.occurredAt - b.occurredAt || a.dedupeKey.localeCompare(b.dedupeKey));
  const witnessed = witnessedActorIds(ordered);
  const snapshots = reduceActors(events, now)
    // Background helpers (a lone SubagentStop) never become characters; an ended character
    // lingers at the memorial hall for a while, then leaves the map — never an ever-growing crowd.
    .filter((a) => witnessed.has(a.id))
    .filter((a) => a.state !== "ended" || now - a.updatedAt <= ENDED_LINGER_MS);
  const activityByActor = currentActivities(ordered, now);
  const receipts = deriveReceipts(events);
  const attention = deriveAttention(ordered, now, attentionOverlays, { receipts, reviewedReceiptIds });
  const { names, taskSummaries } = actorLabels(snapshots, ordered);

  const actors: ActorView[] = snapshots
    .map((a) => {
      const activity = activityByActor.get(a.id);
      const attentionIds = attention
        .filter((item) => needsUser(item) && item.actorIds.includes(a.id))
        .map((item) => item.id);
      return {
        ...a,
        displayName: names.get(a.id) ?? `${SOURCE_LABEL[a.source]} ${shortId(a.sessionId)}`,
        station: stationFor(a.state, activity),
        attentionIds,
        ...opt("currentActivityId", activity?.id),
        ...opt("taskSummary", taskSummaries.get(a.id)),
      };
    })
    .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));

  const projects: ProjectView[] = [...new Set(actors.map((a) => a.projectId))]
    .map((id) => {
      const own = actors.filter((a) => a.projectId === id);
      return {
        id,
        displayName: projectName(id),
        actorIds: own.map((a) => a.id),
        openAttentionCount: attention.filter((item) => needsUser(item) && item.projectId === id).length,
        verifiedReceiptCount: receipts.filter((r) => r.projectId === id && r.confidence === "verified").length,
        updatedAt: Math.max(...own.map((a) => a.updatedAt)),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    generatedAt: now,
    coverage,
    projects,
    actors,
    activities: [...activityByActor.values()].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id)),
    attention,
    recentReceipts: receipts
      .slice(-RECENT_RECEIPT_LIMIT)
      .reverse()
      .map((r) => receiptView(r, reviewedReceiptIds)),
    milestones: projects.flatMap((p) =>
      milestonesFor(
        p.id,
        receipts.filter((r) => r.projectId === p.id),
      ),
    ),
  };
};
