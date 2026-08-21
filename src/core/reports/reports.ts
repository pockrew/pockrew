import type { AttentionItem, AttentionPriority, AttentionType } from "#contracts/attention.js";
import type { AgentEvent } from "#contracts/events.js";
import type { WorkReceipt } from "#contracts/receipts.js";
import type { BlindWindow, FailureEvent, ProjectChanges, ShiftReport } from "#contracts/reports.js";

/**
 * Shift Report builder (spec "Shift Report"): fully deterministic — every string is assembled
 * from event/receipt fields, no LLM, no invented narrative. Pure: window bounds come in as
 * parameters, derived collections (receipts, attention) are passed in by the caller so the
 * report never recomputes what the rebuild already has. Shapes live in #contracts/reports.js
 * (owner-approved 2026-08-21) — web renders the same type this module builds.
 */

export const NO_VERIFIED_OUTCOME = "Agents were active, but no verified outcome was captured.";

const PRIORITY_RANK: Record<AttentionPriority, number> = { critical: 0, high: 1, normal: 2, info: 3 };

/** Spec order: approval > conflict > error > ready review > coverage; the two unlisted types
 *  slot in next to their nearest kin (question with approval, stalled before coverage). */
const ACTION_RANK: Record<AttentionType, number> = {
  approval: 0,
  question: 1,
  conflict: 2,
  error: 3,
  ready_review: 4,
  stalled: 5,
  coverage_gap: 6,
};

const ACTION_VERB: Record<AttentionType, string> = {
  approval: "Approve or deny",
  question: "Answer",
  conflict: "Check overlap",
  error: "Unblock",
  ready_review: "Review",
  stalled: "Check stalled actor",
  coverage_gap: "Restore coverage",
};

/** Daemon-honesty and heartbeat kinds — presence of only these is "I was not running / idling",
 *  never "agents were active". */
const NON_ACTIVITY_KINDS = new Set<AgentEvent["kind"]>(["coverage_lost", "coverage_restored", "process_alive"]);

export const buildShiftReport = (input: {
  events: AgentEvent[];
  receipts: WorkReceipt[];
  attention: AttentionItem[];
  from: number;
  to: number;
}): ShiftReport => {
  const { from, to } = input;
  const inWindow = (ts: number): boolean => ts > from && ts <= to;

  const seen = new Set<string>();
  const windowEvents = input.events
    .filter((e) => (seen.has(e.dedupeKey) ? false : (seen.add(e.dedupeKey), true)))
    .filter((e) => inWindow(e.occurredAt))
    .sort((a, b) => a.occurredAt - b.occurredAt || a.dedupeKey.localeCompare(b.dedupeKey));

  const windowReceipts = input.receipts
    .filter((r) => inWindow(r.occurredAt))
    .sort((a, b) => a.occurredAt - b.occurredAt || a.id.localeCompare(b.id));

  const stillNeedsUser = input.attention.filter((it) => it.status === "open" || it.status === "acknowledged");

  // Spec §1 is "open approvals, errors, conflicts" — coverage lives in §5, review/stalled reach
  // the user through nextActions only.
  const NEEDS_YOU_TYPES = new Set<AttentionType>(["approval", "question", "error", "conflict"]);
  const needsYouNow = stillNeedsUser
    .filter((it) => NEEDS_YOU_TYPES.has(it.type))
    .sort(
      (a, b) =>
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.openedAt - b.openedAt || a.id.localeCompare(b.id),
    );

  const shipped = windowReceipts.filter((r) => r.confidence === "verified");
  const completedActivity = windowReceipts.filter((r) => r.confidence !== "verified");

  const filesByProject = new Map<string, Set<string>>();
  for (const e of windowEvents) {
    // Completed signals only: a PreToolUse write may still be denied or fail — it changed nothing.
    if (e.kind !== "activity_completed" && e.kind !== "file_touched") continue;
    if (e.file?.operation !== "write" || e.file.relativePath === "") continue;
    const files = filesByProject.get(e.projectId) ?? new Set<string>();
    files.add(e.file.relativePath);
    filesByProject.set(e.projectId, files);
  }
  const changed: ProjectChanges[] = [...filesByProject.entries()]
    .map(([projectId, files]) => ({ projectId, files: [...files].sort() }))
    .sort((a, b) => a.projectId.localeCompare(b.projectId));

  const failures = windowReceipts.filter((r) => r.kind === "test_failed" || r.kind === "build_failed");
  const errors: FailureEvent[] = windowEvents
    .filter((e) => e.kind === "activity_failed")
    .map((e) => ({
      actorId: e.actorId,
      projectId: e.projectId,
      occurredAt: e.occurredAt,
      ...(e.summary !== undefined ? { summary: e.summary } : {}),
    }));
  const recoveries = windowReceipts.filter((r) => r.kind === "failure_recovered");

  // Blind windows off the daemon's own coverage events; an unclosed loss ends at the window edge.
  // This is how the report distinguishes "nothing happened" from "I was not running" (spec).
  const blindWindows: BlindWindow[] = [];
  let openLoss: number | undefined;
  for (const e of windowEvents) {
    if (e.kind === "coverage_lost" && openLoss === undefined) openLoss = e.occurredAt;
    if (e.kind === "coverage_restored" && openLoss !== undefined) {
      blindWindows.push({ from: openLoss, to: e.occurredAt });
      openLoss = undefined;
    }
  }
  if (openLoss !== undefined) blindWindows.push({ from: openLoss, to });

  // Next actions come from EVERY item that still needs the user (spec order includes review and
  // coverage), not just the §1 subset.
  const nextActions = [...stillNeedsUser]
    .sort((a, b) => ACTION_RANK[a.type] - ACTION_RANK[b.type] || a.openedAt - b.openedAt || a.id.localeCompare(b.id))
    .map((it) => `${ACTION_VERB[it.type]}: ${it.summary}`);

  const wasActive = windowEvents.some((e) => !NON_ACTIVITY_KINDS.has(e.kind));

  return {
    from,
    to,
    needsYouNow,
    shipped,
    completedActivity,
    changed,
    problems: { failures, errors, recoveries, blindWindows },
    nextActions,
    ...(wasActive && shipped.length === 0 ? { noVerifiedOutcome: NO_VERIFIED_OUTCOME } : {}),
  };
};
