// ❄️ FROZEN — repo owner must approve changes. Stop and propose a diff instead of editing.

export type WorkReceipt = {
  id: string;
  projectId: string;
  actorId: string;
  sessionId: string;
  turnId?: string;
  kind:
    | "task_completed"
    | "subagent_returned"
    | "turn_completed"
    | "test_passed"
    | "test_failed"
    | "build_passed"
    | "build_failed"
    | "commit_created"
    | "failure_recovered"
    | "review_ready";
  title: string;
  summary?: string;
  confidence: "verified" | "observed" | "inferred";
  occurredAt: number;
  durationMs?: number;
  files?: string[]; // relative paths only
  git?: { repoRoot: string; branch?: string; commit?: string };
  evidence: Array<{
    type: "source_event" | "exit_code" | "git" | "file_change";
    ref: string;
    label: string;
  }>;
};

export type ReceiptKind = WorkReceipt["kind"];
export type ReceiptEvidence = WorkReceipt["evidence"][number];
