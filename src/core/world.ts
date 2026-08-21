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

/** Spec "Attention queue" default priorities for the types an AgentEvent can carry. */
const PRIORITY: Record<NonNullable<AgentEvent["attention"]>["type"], AttentionView["priority"]> = {
  approval: "high",
  question: "high",
  error: "high",
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

/** A session's own first user prompt — the only real signal for what a main actor is doing. */
const firstPromptFor = (ordered: AgentEvent[], actorId: string): string | undefined => {
  for (const e of ordered) {
    // Skip tag-like system injections (<task-notification>, <system-reminder>, …) — not a human
    // prompt. Skip-and-fallback only: never clean or reword the text (spec principle 10).
    if (e.actorId === actorId && e.kind === "prompt_submitted" && e.summary && !e.summary.startsWith("<")) {
      return e.summary;
    }
  }
  return undefined;
};

/**
 * Descriptions off the parent's own Task/Agent tool calls (normalize.ts carries each one as
 * `activity.operation`, the same slot bash uses for its command) — SubagentStart itself names no
 * task. No id survives normalize to match a description to the specific session it spawned, so a
 * description is only trusted when the pairing can't be wrong: exactly one spawn call and exactly
 * one subagent for that parent. Two Task calls racing ahead of two SubagentStarts can arrive in
 * either order — guessing by position risks naming a subagent after the wrong call, which is an
 * invented relationship (AGENTS rule 7) — so anything but a clean 1:1 falls back structurally.
 */
const spawnDescriptionsFor = (ordered: AgentEvent[], parentActorId: string): string[] =>
  ordered
    .filter(
      (e) =>
        e.actorId === parentActorId &&
        e.kind === "activity_started" &&
        (e.activity?.tool === "Task" || e.activity?.tool === "Agent") &&
        e.activity.operation !== undefined,
    )
    .map((e) => e.activity!.operation!);

/** The real `agent_type` off this subagent's own SubagentStart (e.g. "general-purpose"), when
 *  the provider sent one — normalize.ts carries it in `summary`. */
const agentTypeFor = (ordered: AgentEvent[], actorId: string): string | undefined => {
  for (const e of ordered) if (e.actorId === actorId && e.kind === "subagent_started" && e.summary) return e.summary;
  return undefined;
};

// A label, not a signal: a main actor's name comes from its own session's first prompt; a
// subagent's from the real description its Task/Agent spawn call carried, but only when that
// pairing is unambiguous. Neither is ever invented or summarized — falling back to a structural
// label (honest agent_type + ordinal when the provider sent one, otherwise a bare ordinal), or the
// bare source+id form when no text exists at all (spec principle 10: unsupported renders as unknown).
const actorNames = (snapshots: ActorSnapshot[], ordered: AgentEvent[]): Map<string, string> => {
  const bySpawnOrder = [...snapshots].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  const names = new Map<string, string>();
  for (const a of bySpawnOrder) {
    if (a.parentActorId !== undefined) continue;
    const prompt = firstPromptFor(ordered, a.id);
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
    const descriptions = spawnDescriptionsFor(ordered, parentId);
    const parentName = names.get(parentId) ?? `${SOURCE_LABEL[subagents[0]!.source]} ${shortId(parentId)}`;
    const unambiguous = descriptions.length === 1 && subagents.length === 1;
    subagents.forEach((a, i) => {
      if (unambiguous) {
        names.set(a.id, truncateDisplayName(descriptions[0]!));
        return;
      }
      const ordinal = i + 1;
      const agentType = agentTypeFor(ordered, a.id);
      const label = agentType ? `${agentType} #${ordinal}` : `Subagent ${ordinal}`;
      // The composed label, not just the parent fragment, is what can run past budget.
      names.set(a.id, truncateDisplayName(`${label} · ${parentName}`));
    });
  }
  return names;
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

/**
 * Open attention, from `attention_requested` events only. One provider request is one idempotent
 * item, keyed on its own `requestId` (spec "Approval safety" / dedupe) so two different permission
 * prompts never stitch into one card; only a request with no id falls back to actor plus type.
 * A request closes on the `attention_resolved` naming it, or on any later activity signal from the
 * same actor — the same rule reduce.ts uses for `waiting_user`, so a character never sits at the
 * boss desk while its session has visibly moved on.
 * ponytail: no snooze, expiry or derived types (stalled, conflict, ready_review, coverage_gap) —
 * those are M4's attention queue.
 */
const openAttention = (events: AgentEvent[]): AttentionView[] => {
  const byKey = new Map<string, AttentionView>();
  const keyFor = (e: AgentEvent, type: NonNullable<AgentEvent["attention"]>["type"]): string => {
    if (e.attention?.requestId !== undefined) return e.attention.requestId;
    // No request id (Claude's permission Notification, which duplicates the PermissionRequest):
    // fold into this actor's open item of the same type instead of stitching a second card.
    for (const [key, item] of byKey) if (item.actorIds[0] === e.actorId && item.type === type) return key;
    return `${e.actorId}:${type}`;
  };
  for (const e of events) {
    if (e.kind === "attention_requested" && e.attention) {
      const key = keyFor(e, e.attention.type);
      const existing = byKey.get(key);
      byKey.set(key, {
        id: `attention:${key}`,
        type: e.attention.type,
        priority: PRIORITY[e.attention.type],
        confidence: e.confidence,
        status: "open",
        actorIds: [e.actorId],
        projectId: e.projectId,
        // The event carrying the request id carries the tool detail too; an id-less follow-up
        // (Notification) must not overwrite it with its vaguer message.
        summary: e.attention.requestId === undefined && existing ? existing.summary : e.attention.summary,
        openedAt: existing?.openedAt ?? e.occurredAt,
        updatedAt: e.occurredAt,
        ...opt("expiresAt", e.attention.expiresAt ?? existing?.expiresAt),
        ...opt("sourceRequestId", e.attention.requestId ?? existing?.sourceRequestId),
      });
      continue;
    }
    if (e.kind === "attention_resolved") {
      // Closes exactly the request it names, never its neighbours.
      const key = keyFor(e, e.attention?.type ?? "approval");
      const item = byKey.get(key);
      if (item && e.occurredAt > item.updatedAt) byKey.delete(key);
      continue;
    }
    if (e.kind !== "activity_started" && e.kind !== "activity_completed") continue;
    // An activity signal says the session moved on but names no request, so it clears this
    // actor's open prompts as a whole — matching what reduce.ts does to `waiting_user`.
    for (const [key, item] of byKey) {
      if (item.actorIds[0] === e.actorId && e.occurredAt > item.updatedAt) byKey.delete(key);
    }
  }
  return [...byKey.values()].sort((a, b) => a.openedAt - b.openedAt || a.id.localeCompare(b.id));
};

const stationFor = (state: ActorView["state"], activity: ActivityView | undefined): Station => {
  if (state === "waiting_user") return "boss_desk"; // spec: waiting on the user → boss desk
  if (activity && (state === "working" || state === "thinking" || state === "blocked")) {
    return STATION_BY_CATEGORY[activity.category];
  }
  return "lounge"; // no current signal (spec: no signal → lounge)
};

const receiptView = (r: WorkReceipt): ReceiptView => ({
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
  // No user signal for "reviewed" exists yet; a mark-reviewed intent lands with the store column.
  reviewed: false,
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

export const assembleWorld = (events: AgentEvent[], now: number, coverage: WorldState["coverage"]): WorldState => {
  const seen = new Set<string>();
  const ordered = events
    .filter((e) => (seen.has(e.dedupeKey) ? false : (seen.add(e.dedupeKey), true)))
    .sort((a, b) => a.occurredAt - b.occurredAt || a.dedupeKey.localeCompare(b.dedupeKey));
  const snapshots = reduceActors(events, now);
  const activityByActor = currentActivities(ordered, now);
  const attention = openAttention(ordered);
  const receipts = deriveReceipts(events);
  const names = actorNames(snapshots, ordered);

  const actors: ActorView[] = snapshots
    .map((a) => {
      const activity = activityByActor.get(a.id);
      const attentionIds = attention.filter((item) => item.actorIds.includes(a.id)).map((item) => item.id);
      return {
        ...a,
        displayName: names.get(a.id) ?? `${SOURCE_LABEL[a.source]} ${shortId(a.sessionId)}`,
        station: stationFor(a.state, activity),
        attentionIds,
        ...opt("currentActivityId", activity?.id),
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
        openAttentionCount: attention.filter((item) => item.projectId === id).length,
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
    recentReceipts: receipts.slice(-RECENT_RECEIPT_LIMIT).reverse().map(receiptView),
    milestones: projects.flatMap((p) =>
      milestonesFor(
        p.id,
        receipts.filter((r) => r.projectId === p.id),
      ),
    ),
  };
};
