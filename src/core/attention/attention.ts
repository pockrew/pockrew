import type { AttentionItem, AttentionPriority, AttentionType } from "#contracts/attention.js";
import type { AgentEvent } from "#contracts/events.js";
import type { WorkReceipt } from "#contracts/receipts.js";
import { deriveConflicts } from "#core/conflicts/conflicts.js";
import { deriveReceipts } from "#core/receipts/receipts.js";
import { defaultTimers } from "#core/reduce/reduce.js";

/**
 * Needs You — the unified attention queue (spec A10). Pure derivation: replay the event window,
 * emit the items that still need the user at `now`, then apply the persisted user lifecycle
 * overlay (ack / snooze / resolve from POST /api/intents). No IO, no clock reads.
 *
 * Producers wired in M4: approval/question/error from `attention_requested`, error streaks from
 * `activity_failed`, `stalled` from an activity past its window, `coverage_gap` from the daemon's
 * own coverage events. M5 wires `conflict` from the same-file detector (core/conflicts) and
 * `ready_review` from `review_ready` receipts (cleared by mark-reviewed).
 */

/** What the user did to an item, persisted by the server so it survives restarts. */
export type AttentionOverlay = {
  status: "acknowledged" | "snoozed" | "resolved";
  snoozedUntil?: number;
  updatedAt: number;
};

/** Spec A10 default priorities. Conflict is "high/normal" by rule — high is the P0 same-file rule. */
export const DEFAULT_PRIORITY: Record<AttentionType, AttentionPriority> = {
  approval: "high",
  question: "high",
  error: "high",
  stalled: "normal",
  conflict: "high",
  ready_review: "normal",
  coverage_gap: "info",
};

/** Spec dedupe: a repeated failure for the same actor within this window updates the open item. */
export const ERROR_STREAK_MS = 300_000;

/** The same window the reducer uses to stop believing an open activity — the chip flips to
 *  `unknown` and the queue calls it stalled on the same rebuild, never disagreeing. */
export const STALLED_AFTER_MS = defaultTimers.activityWindowMs;

/** Spread helper: include an optional property only when it has a value (exactOptionalPropertyTypes). */
const opt = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } => {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
};

const item = (
  id: string,
  type: AttentionType,
  e: Pick<AgentEvent, "actorId" | "projectId" | "confidence" | "occurredAt">,
  summary: string,
): AttentionItem => ({
  id,
  type,
  priority: DEFAULT_PRIORITY[type],
  confidence: e.confidence,
  status: "open",
  actorIds: [e.actorId],
  projectId: e.projectId,
  summary,
  openedAt: e.occurredAt,
  updatedAt: e.occurredAt,
});

/**
 * Provider-requested items (approval/question/error off `attention_requested`). One provider
 * request is one idempotent item, keyed on its own `requestId` (spec "Approval safety") so two
 * different permission prompts never stitch into one card; only a request with no id falls back
 * to actor plus type. A request leaves the queue on the `attention_resolved` naming it, or on any
 * later activity signal from the same actor — the provider request is then no longer valid
 * (lifecycle "expired"), the same rule reduce.ts uses for `waiting_user`.
 */
const foldRequested = (byKey: Map<string, AttentionItem>, e: AgentEvent): void => {
  const keyFor = (type: NonNullable<AgentEvent["attention"]>["type"]): string => {
    if (e.attention?.requestId !== undefined) return e.attention.requestId;
    // No request id (Claude's permission Notification, which duplicates the PermissionRequest):
    // fold into this actor's open item of the same type instead of stitching a second card.
    for (const [key, it] of byKey) if (it.actorIds[0] === e.actorId && it.type === type) return key;
    return `${e.actorId}:${type}`;
  };
  if (e.kind === "attention_requested" && e.attention) {
    const key = keyFor(e.attention.type);
    const existing = byKey.get(key);
    byKey.set(key, {
      ...item(`attention:${key}`, e.attention.type, e, e.attention.summary),
      // The event carrying the request id carries the tool detail too; an id-less follow-up
      // (Notification) must not overwrite it with its vaguer message.
      summary: e.attention.requestId === undefined && existing ? existing.summary : e.attention.summary,
      openedAt: existing?.openedAt ?? e.occurredAt,
      updatedAt: e.occurredAt,
      ...opt("expiresAt", e.attention.expiresAt ?? existing?.expiresAt),
      ...opt("sourceRequestId", e.attention.requestId ?? existing?.sourceRequestId),
    });
    return;
  }
  if (e.kind === "attention_resolved") {
    // Closes exactly the request it names, never its neighbours.
    const key = keyFor(e.attention?.type ?? "approval");
    const it = byKey.get(key);
    if (it && e.occurredAt > it.updatedAt) byKey.delete(key);
    return;
  }
  if (e.kind !== "activity_started" && e.kind !== "activity_completed" && !isActorEnd(e)) return;
  // An activity signal says the session moved on; a session end says nobody is asking any more.
  // Either way the provider request is no longer valid — a dead prompt must never sit in the
  // queue (or ping the OS) forever. Matches what reduce.ts does to `waiting_user`.
  for (const [key, it] of byKey) {
    if (it.actorIds[0] === e.actorId && e.occurredAt > it.updatedAt) byKey.delete(key);
  }
};

/** The actor's own terminal signal — a subagent's SubagentStop is its session end (reduce.ts). */
const isActorEnd = (e: AgentEvent): boolean => e.kind === "session_ended" || e.kind === "subagent_completed";

type ErrorStreak = { lastAt: number; count: number; itm: AttentionItem };

/**
 * Error items off `activity_failed`: a failure the session has not recovered from. A repeated
 * failure for the same actor/category within 5 minutes updates the open item instead of spamming
 * a new one (spec dedupe); a failure past that window replaces it — one open error per
 * actor/category. Any later activity signal from the actor is the recovery that clears it, and a
 * session end clears it too — an ended session will never recover, and the failure itself stays
 * on the record through its events (and receipts, M5), not through an eternal queue item.
 */
const foldError = (streaks: Map<string, ErrorStreak>, e: AgentEvent): void => {
  if (e.kind === "activity_started" || e.kind === "activity_completed" || isActorEnd(e)) {
    for (const [key, s] of streaks) {
      if (key.startsWith(`${e.actorId}:`) && e.occurredAt > s.lastAt) streaks.delete(key);
    }
    return;
  }
  if (e.kind !== "activity_failed") return;
  const category = e.activity?.category ?? "terminal";
  const key = `${e.actorId}:${category}`;
  const summary = e.summary ?? `${e.activity?.tool ?? category} failed`;
  const open = streaks.get(key);
  if (open && e.occurredAt - open.lastAt <= ERROR_STREAK_MS) {
    open.lastAt = e.occurredAt;
    open.count += 1;
    open.itm = {
      ...open.itm,
      summary: open.count > 1 ? `×${open.count} — ${summary}` : summary,
      updatedAt: e.occurredAt,
      confidence: e.confidence,
    };
    return;
  }
  streaks.set(key, {
    lastAt: e.occurredAt,
    count: 1,
    itm: item(`attention:error:${key}:${e.occurredAt}`, "error", e, summary),
  });
};

/** Serial open-activity tracking per actor — the same assumption reduce.ts documents. */
type OpenActivity = Pick<AgentEvent, "actorId" | "projectId" | "occurredAt"> & { tool?: string };

const foldActivity = (open: Map<string, OpenActivity>, e: AgentEvent): void => {
  if (e.kind === "activity_started") {
    open.set(e.actorId, {
      actorId: e.actorId,
      projectId: e.projectId,
      occurredAt: e.occurredAt,
      ...opt("tool", e.activity?.tool),
    });
    return;
  }
  if (e.kind === "activity_completed" || e.kind === "activity_failed" || isActorEnd(e)) {
    open.delete(e.actorId);
  }
};

/** An open activity past its window at `now`: no progress signal — the actor looks stalled. The
 *  summary is deliberately time-free: minutes baked in here would re-patch the whole attention key
 *  every minute with nothing real changed — the client renders elapsed time from `openedAt`. */
const stalledItems = (open: Map<string, OpenActivity>, now: number): AttentionItem[] =>
  [...open.values()]
    .filter((a) => now - a.occurredAt > STALLED_AFTER_MS)
    .map((a) =>
      item(
        `attention:stalled:${a.actorId}:${a.occurredAt}`,
        "stalled",
        {
          actorId: a.actorId,
          projectId: a.projectId,
          confidence: "inferred",
          occurredAt: a.occurredAt + STALLED_AFTER_MS,
        },
        `No progress signal${a.tool ? ` — last was ${a.tool}` : ""}`,
      ),
    );

/** Coverage gaps off the daemon's own honesty events; a matching restore closes the gap. */
const foldCoverage = (gaps: Map<string, AttentionItem>, e: AgentEvent): void => {
  if (e.kind === "coverage_lost") {
    gaps.set(
      e.source,
      item(`attention:coverage_gap:${e.source}:${e.occurredAt}`, "coverage_gap", e, e.summary ?? "coverage lost"),
    );
    return;
  }
  if (e.kind === "coverage_restored") gaps.delete(e.source);
};

/** The user's persisted action on an item. Event truth wins over the overlay in both directions:
 *  an item the events already closed never resurfaces, an elapsed snooze reopens (lifecycle
 *  snoozed → open), and an overlay older than the item's latest event is stale — the user acted on
 *  what they saw *then*, so a genuinely newer signal (a fresh failure updating the same streak, a
 *  new prompt folding into an id-less approval key) reopens rather than being silently masked. */
const applyOverlay = (it: AttentionItem, overlay: AttentionOverlay | undefined, now: number): AttentionItem => {
  if (!overlay) return it;
  if (overlay.updatedAt < it.updatedAt) return it;
  if (overlay.status === "snoozed" && (overlay.snoozedUntil === undefined || overlay.snoozedUntil <= now)) return it;
  return {
    ...it,
    status: overlay.status,
    updatedAt: Math.max(it.updatedAt, overlay.updatedAt),
    ...opt("expiresAt", overlay.status === "snoozed" ? overlay.snoozedUntil : it.expiresAt),
  };
};

/**
 * One `ready_review` item per actor, off that actor's LATEST unreviewed `review_ready` receipt —
 * a newer turn's writes supersede the older ones for review purposes (the receipts themselves all
 * stay in the warehouse). Marking the receipt reviewed clears the item; a fresh receipt after an
 * ack is genuinely new work, so the stale-overlay rule reopens it. The item dies with its session
 * like every other queue item (A10 expire — the queue is live "needs you", never a history); the
 * receipt itself remains the durable record in the warehouse and the shift report.
 */
const readyReviewItems = (
  events: AgentEvent[],
  receipts: WorkReceipt[],
  reviewedReceiptIds: ReadonlySet<string>,
): AttentionItem[] => {
  const endedAt = new Map<string, number>();
  for (const e of events) {
    if (isActorEnd(e)) endedAt.set(e.actorId, Math.max(endedAt.get(e.actorId) ?? 0, e.occurredAt));
  }
  const byActor = new Map<string, { first: WorkReceipt; last: WorkReceipt }>();
  for (const r of receipts) {
    if (r.kind !== "review_ready" || reviewedReceiptIds.has(r.id)) continue;
    if ((endedAt.get(r.actorId) ?? -1) >= r.occurredAt) continue; // session over — receipt is the record
    const open = byActor.get(r.actorId);
    // receipts arrive sorted ascending — the last one seen is the latest.
    byActor.set(r.actorId, open ? { first: open.first, last: r } : { first: r, last: r });
  }
  return [...byActor.values()].map(({ first, last }) => ({
    ...item(
      `attention:ready_review:${last.actorId}`,
      "ready_review",
      { actorId: last.actorId, projectId: last.projectId, confidence: last.confidence, occurredAt: first.occurredAt },
      `Ready for review — ${last.files?.length ?? 0} file(s)`,
    ),
    updatedAt: last.occurredAt,
    sourceRequestId: last.id, // the receipt to mark reviewed
  }));
};

/**
 * Everything that still needs the user at `now`, lifecycle applied. Resolved and expired items are
 * not returned — the queue is what remains, not a history (the events and audit trail are).
 * `opts.receipts` lets the caller reuse an already-derived receipt list (assembleWorld has one);
 * omitted, it is derived here. `opts.reviewedReceiptIds` clears ready_review items.
 */
export const deriveAttention = (
  events: AgentEvent[],
  now: number,
  overlays: ReadonlyMap<string, AttentionOverlay> = new Map(),
  opts: { receipts?: WorkReceipt[]; reviewedReceiptIds?: ReadonlySet<string> } = {},
): AttentionItem[] => {
  const seen = new Set<string>();
  const ordered = events
    .filter((e) => (seen.has(e.dedupeKey) ? false : (seen.add(e.dedupeKey), true)))
    .sort((a, b) => a.occurredAt - b.occurredAt || a.dedupeKey.localeCompare(b.dedupeKey));

  const requested = new Map<string, AttentionItem>();
  const streaks = new Map<string, ErrorStreak>();
  const openActivities = new Map<string, OpenActivity>();
  const gaps = new Map<string, AttentionItem>();
  for (const e of ordered) {
    foldRequested(requested, e);
    foldError(streaks, e);
    foldActivity(openActivities, e);
    foldCoverage(gaps, e);
  }

  return [
    ...requested.values(),
    ...[...streaks.values()].map((s) => s.itm),
    ...stalledItems(openActivities, now),
    ...gaps.values(),
    ...deriveConflicts(ordered, now),
    ...readyReviewItems(ordered, opts.receipts ?? deriveReceipts(ordered), opts.reviewedReceiptIds ?? new Set()),
  ]
    .map((it) => applyOverlay(it, overlays.get(it.id), now))
    .filter((it) => it.status !== "resolved" && it.status !== "expired")
    .sort((a, b) => a.openedAt - b.openedAt || a.id.localeCompare(b.id));
};

/** The pure lifecycle transition behind POST /api/intents; null = not an attention intent. */
export const overlayForIntent = (
  intent: { kind: string; id?: string; until?: number },
  now: number,
): { id: string; overlay: AttentionOverlay } | null => {
  if (typeof intent.id !== "string" || intent.id === "") return null;
  if (intent.kind === "attention_ack") return { id: intent.id, overlay: { status: "acknowledged", updatedAt: now } };
  if (intent.kind === "attention_resolve") return { id: intent.id, overlay: { status: "resolved", updatedAt: now } };
  if (intent.kind === "attention_snooze") {
    if (typeof intent.until !== "number" || !Number.isFinite(intent.until) || intent.until <= now) return null;
    return { id: intent.id, overlay: { status: "snoozed", snoozedUntil: intent.until, updatedAt: now } };
  }
  return null;
};
