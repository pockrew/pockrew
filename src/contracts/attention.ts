// ❄️ FROZEN — repo owner must approve changes. Stop and propose a diff instead of editing.

export type AttentionItem = {
  id: string;
  type: "approval" | "question" | "error" | "stalled" | "conflict" | "ready_review" | "coverage_gap";
  priority: "critical" | "high" | "normal" | "info";
  confidence: "verified" | "observed" | "inferred";
  status: "open" | "acknowledged" | "snoozed" | "resolved" | "expired";
  actorIds: string[];
  projectId: string;
  summary: string;
  openedAt: number;
  updatedAt: number;
  expiresAt?: number;
  sourceRequestId?: string;
};

export type AttentionType = AttentionItem["type"];
export type AttentionPriority = AttentionItem["priority"];
export type AttentionStatus = AttentionItem["status"];
