// ❄️ FROZEN — repo owner must approve changes. Stop and propose a diff instead of editing.
// Approved by owner 2026-08-21 (M5): shift-report shape shared by core/server and web.

import type { AttentionItem } from "./attention.js";
import type { AgentEvent } from "./events.js";
import type { WorkReceipt } from "./receipts.js";

export type BlindWindow = { from: number; to: number };

/** Spec section 4 names "project, branch, relative files" — no git signal exists yet, so branch
 *  is omitted rather than faked. */
export type ProjectChanges = { projectId: string; files: string[] };

/** A tool/API failure in the window (`activity_failed`) — most failures never become a
 *  test/build receipt, so section 5 folds the raw events in alongside them. */
export type FailureEvent = Pick<AgentEvent, "actorId" | "projectId" | "occurredAt"> & { summary?: string };

export type ShiftReport = {
  from: number;
  to: number;
  // The 6 spec sections, in spec order:
  needsYouNow: AttentionItem[];
  shipped: WorkReceipt[];
  completedActivity: WorkReceipt[];
  changed: ProjectChanges[];
  problems: {
    failures: WorkReceipt[];
    errors: FailureEvent[];
    recoveries: WorkReceipt[];
    blindWindows: BlindWindow[];
  };
  nextActions: string[];
  /** Present iff agents were active in the window and `shipped` is empty. Exact spec sentence. */
  noVerifiedOutcome?: string;
};
