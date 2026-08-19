// ❄️ FROZEN — repo owner must approve changes. Stop and propose a diff instead of editing.
// The *View types are not yet confirmed against real captured payloads.

import type { AttentionItem } from "./attention.js";
import type { Confidence, SourceId } from "./events.js";
import type { WorkReceipt } from "./receipts.js";

/** Canonical actor states, in precedence order. */
export type ActorState =
  "starting" | "thinking" | "working" | "waiting_user" | "blocked" | "completed" | "idle" | "ended" | "unknown";

/** Semantic stations. Skin naming (Town vs Corp) is the renderer's business. */
export type Station = "library" | "workshop" | "lab" | "review" | "hq" | "boss_desk" | "lounge";

export type ActivityCategory = "research" | "code" | "terminal" | "review" | "coordination";

export type ProjectView = {
  id: string;
  displayName: string;
  actorIds: string[];
  openAttentionCount: number;
  verifiedReceiptCount: number;
  updatedAt: number;
};

export type ActorView = {
  id: string;
  projectId: string;
  sessionId: string;
  source: SourceId;
  displayName: string;
  state: ActorState;
  /** Shown in the inspector only; the world view does not surface confidence. */
  stateConfidence: Confidence;
  station: Station;
  parentActorId?: string;
  currentActivityId?: string;
  /** Open attention items pointing at this actor. */
  attentionIds: string[];
  startedAt: number;
  updatedAt: number;
};

export type ActivityView = {
  id: string;
  actorId: string;
  projectId: string;
  category: ActivityCategory;
  tool?: string;
  operation?: string;
  status: "running" | "completed" | "failed" | "unknown";
  confidence: Confidence;
  startedAt: number;
  endedAt?: number;
};

export type AttentionView = AttentionItem;

export type ReceiptView = Pick<
  WorkReceipt,
  "id" | "projectId" | "actorId" | "kind" | "title" | "confidence" | "occurredAt"
> & {
  /** Truncated to 160 chars; full text lives in the inspector. */
  summary?: string;
  fileCount: number;
  reviewed: boolean;
};

/** Every milestone traces back to a verified receipt count. */
export type MilestoneView = {
  key: "first_delivery" | "workshop_1" | "workshop_2" | "district_landmark" | "recovery_badge";
  projectId: string;
  label: string;
  current: number;
  target: number;
  achievedAt?: number;
};

export type WorldState = {
  generatedAt: number;
  coverage: Array<{
    source: "claude" | "codex";
    status: "healthy" | "degraded" | "offline";
    message?: string;
  }>;
  projects: ProjectView[];
  actors: ActorView[];
  activities: ActivityView[];
  attention: AttentionView[];
  recentReceipts: ReceiptView[];
  milestones: MilestoneView[];
};
