import type { AttentionItem } from "#contracts/attention.js";
import type { AgentEvent } from "#contracts/events.js";

/**
 * Same-file conflict detector (spec "Conflict detection", P0 rule only): two different actors
 * writing the same relative path in the same project within 10 minutes is "overlapping work" —
 * early warning, never a lock, never a claimed merge conflict. Pure derivation: tracks only
 * path / actor / timestamp / operation, never file contents. The other three spec rules
 * (same-directory, rewrite-tug-of-war, cross-worktree) are out of M5 scope.
 */

export const CONFLICT_WINDOW_MS = 600_000;

type ConflictWindow = {
  projectId: string;
  path: string;
  pair: [string, string]; // sorted actor ids
  openedAt: number; // ts of the write that first created the overlap — embedded in the id
  lastOverlapAt: number;
};

const pairKey = (w: Pick<ConflictWindow, "projectId" | "path" | "pair">): string =>
  `${w.projectId}\n${w.path}\n${w.pair[0]}\n${w.pair[1]}`;

/**
 * One AttentionItem per pair+path+window, `open` only — a window resolved by an actor ending or
 * expired by 10 quiet minutes is simply not emitted (the queue is what remains, same philosophy
 * as deriveAttention). Overlapping writes inside a live window update the existing item in place
 * (`updatedAt` advances, id stays) so the user is alerted once, not once per write.
 */
export const deriveConflicts = (events: AgentEvent[], now: number): AttentionItem[] => {
  const seen = new Set<string>();
  const ordered = events
    .filter((e) => (seen.has(e.dedupeKey) ? false : (seen.add(e.dedupeKey), true)))
    .sort((a, b) => a.occurredAt - b.occurredAt || a.dedupeKey.localeCompare(b.dedupeKey));

  const lastWrite = new Map<string, Map<string, number>>(); // projectId\npath → actorId → ts
  const windows = new Map<string, ConflictWindow[]>(); // pairKey → windows, last is live
  const endedAt = new Map<string, number>(); // actorId → latest session-end signal
  const turnEndedAt = new Map<string, number>(); // actorId → latest turn_stop

  for (const e of ordered) {
    if (e.kind === "session_ended" || e.kind === "subagent_completed") {
      endedAt.set(e.actorId, Math.max(endedAt.get(e.actorId) ?? 0, e.occurredAt));
      continue;
    }
    // turn_stop sentinel — same string normalize.ts produces and reduce.ts/receipts.ts match.
    if (e.kind === "activity_completed" && e.activity?.operation === "turn_stop") {
      turnEndedAt.set(e.actorId, Math.max(turnEndedAt.get(e.actorId) ?? 0, e.occurredAt));
      continue;
    }
    // Completed signals only (same verdict as the report's "Changed" section): a PreToolUse
    // write may still be denied or fail — alerting on it would fake a write that never happened.
    if (e.kind !== "activity_completed" && e.kind !== "file_touched") continue;
    if (e.file?.operation !== "write" || e.file.relativePath === "") continue;
    const fileKey = `${e.projectId}\n${e.file.relativePath}`;
    const byActor = lastWrite.get(fileKey) ?? new Map<string, number>();
    for (const [other, ts] of byActor) {
      if (other === e.actorId || e.occurredAt - ts > CONFLICT_WINDOW_MS) continue;
      const pair: [string, string] = other < e.actorId ? [other, e.actorId] : [e.actorId, other];
      const w: Pick<ConflictWindow, "projectId" | "path" | "pair"> = {
        projectId: e.projectId,
        path: e.file.relativePath,
        pair,
      };
      const list = windows.get(pairKey(w)) ?? [];
      const live = list[list.length - 1];
      if (live && e.occurredAt - live.lastOverlapAt <= CONFLICT_WINDOW_MS) {
        live.lastOverlapAt = e.occurredAt;
      } else {
        list.push({ ...w, openedAt: e.occurredAt, lastOverlapAt: e.occurredAt });
      }
      windows.set(pairKey(w), list);
    }
    byActor.set(e.actorId, e.occurredAt);
    lastWrite.set(fileKey, byActor);
  }

  const items: AttentionItem[] = [];
  for (const list of windows.values()) {
    for (const w of list) {
      if (w.lastOverlapAt + CONFLICT_WINDOW_MS <= now) continue; // 10 quiet minutes → resolved
      const ended = w.pair.some((actor) => (endedAt.get(actor) ?? 0) >= w.lastOverlapAt);
      if (ended) continue; // an actor of the pair stopped — the overlap risk is over
      // Spec "resolve when the actor or turn ends": one turn ending resolves nothing (the other
      // actor is still mid-write), but BOTH turns done means the overlapping moment has passed —
      // a new write inside the window would reopen it as a fresh overlap anyway.
      const bothTurnsDone = w.pair.every((actor) => (turnEndedAt.get(actor) ?? 0) >= w.lastOverlapAt);
      if (bothTurnsDone) continue;
      items.push({
        id: `conflict:${w.projectId}:${w.path}:${w.pair[0]}:${w.pair[1]}:${w.openedAt}`,
        type: "conflict",
        priority: "high", // spec table: same-file P0 rule is high (DEFAULT_PRIORITY twin — no import, attention.ts imports us)
        confidence: "observed",
        status: "open",
        actorIds: [...w.pair],
        projectId: w.projectId,
        summary: `Overlapping work on ${w.path}`,
        openedAt: w.openedAt,
        updatedAt: w.lastOverlapAt,
        expiresAt: w.lastOverlapAt + CONFLICT_WINDOW_MS,
      });
    }
  }
  return items;
};
