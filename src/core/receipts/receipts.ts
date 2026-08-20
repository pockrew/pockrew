import type { AgentEvent } from "#contracts/events.js";
import type { ReceiptKind, WorkReceipt } from "#contracts/receipts.js";

/**
 * AgentEvent[] → WorkReceipt[]. Pure derivation over canonical events plus the
 * read-only evidence already carried on them (spec: "Derivation"). No IO, no
 * clock, no randomness — ids and ordering come entirely from the input events.
 */

type Category = "test" | "build";

// Unambiguous prefixes only (spec: "Derivation"). An unrecognized command yields no receipt.
const TEST_PREFIXES = ["npm test", "pnpm test", "pytest", "cargo test", "go test", "npm run test", "vitest"];
const BUILD_PREFIXES = ["npm run build", "pnpm build", "cargo build", "go build", "tsc"];

const CATEGORY_LABEL: Record<Category, string> = { test: "Tests", build: "Build" };

// A prefix only matches at a word boundary: end-of-string or whitespace next.
// "npm test-fixtures/regen.js" is not "npm test" — bare startsWith would fake that match.
const matchesPrefix = (command: string, prefix: string): boolean => {
  if (!command.startsWith(prefix)) return false;
  const boundary = command[prefix.length];
  return boundary === undefined || /\s/.test(boundary);
};

const classify = (command: string | undefined): Category | undefined => {
  const trimmed = command?.trim();
  if (!trimmed) return undefined;
  if (TEST_PREFIXES.some((p) => matchesPrefix(trimmed, p))) return "test";
  if (BUILD_PREFIXES.some((p) => matchesPrefix(trimmed, p))) return "build";
  return undefined;
};

/** Spread helper: include an optional property only when it has a value. */
const opt = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } => {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
};

const receiptId = (kind: ReceiptKind, dedupeKey: string): string => `receipt:${kind}:${dedupeKey}`;

const turnKey = (actorId: string, turnId: string | undefined): string => `${actorId}:${turnId ?? ""}`;

type Base = Pick<WorkReceipt, "projectId" | "actorId" | "sessionId" | "turnId">;

const baseFor = (e: AgentEvent): Base => ({
  projectId: e.projectId,
  actorId: e.actorId,
  sessionId: e.sessionId,
  ...opt("turnId", e.turnId),
});

/** Bash tool outcome, only for a recognized test/build command that carries an exit code. */
const bashOutcome = (e: AgentEvent): { category: Category; exitCode: number } | undefined => {
  if (e.activity?.tool !== "Bash") return undefined;
  const category = classify(e.activity.operation);
  if (!category || e.activity.exitCode === undefined) return undefined;
  return { category, exitCode: e.activity.exitCode };
};

export const deriveReceipts = (events: AgentEvent[]): WorkReceipt[] => {
  const seen = new Set<string>();
  const deduped = events.filter((e) => {
    if (seen.has(e.dedupeKey)) return false;
    seen.add(e.dedupeKey);
    return true;
  });
  const sorted = [...deduped].sort((a, b) => a.occurredAt - b.occurredAt);

  // Turn → unique relative paths written, over the whole replay (spec rule 3).
  const writesByTurn = new Map<string, Set<string>>();
  for (const e of sorted) {
    if (e.file?.operation === "write") {
      const key = turnKey(e.actorId, e.turnId);
      const paths = writesByTurn.get(key) ?? new Set<string>();
      paths.add(e.file.relativePath);
      writesByTurn.set(key, paths);
    }
  }

  // Last unresolved failure per actor+turn+category, cleared once a pass recovers it (spec rule 6).
  const openFailures = new Map<string, { exitCode: number }>();

  const receipts: WorkReceipt[] = [];

  for (const e of sorted) {
    if (e.kind === "task_completed") {
      receipts.push({
        id: receiptId("task_completed", e.dedupeKey),
        ...baseFor(e),
        kind: "task_completed",
        title: e.summary ?? "Task completed",
        confidence: "verified",
        occurredAt: e.occurredAt,
        evidence: [{ type: "source_event", ref: e.dedupeKey, label: "TaskCompleted hook" }],
      });
      continue;
    }

    if (e.kind === "subagent_completed") {
      receipts.push({
        id: receiptId("subagent_returned", e.dedupeKey),
        ...baseFor(e),
        kind: "subagent_returned",
        title: e.summary ?? "Subagent returned",
        ...opt("summary", e.summary),
        confidence: "observed",
        occurredAt: e.occurredAt,
        evidence: [{ type: "source_event", ref: e.dedupeKey, label: "SubagentStop hook" }],
      });
      continue;
    }

    if (e.kind === "activity_completed" && e.activity?.operation === "turn_stop") {
      receipts.push({
        id: receiptId("turn_completed", e.dedupeKey),
        ...baseFor(e),
        kind: "turn_completed",
        title: "Turn completed",
        ...opt("summary", e.summary),
        confidence: "observed",
        occurredAt: e.occurredAt,
        evidence: [{ type: "source_event", ref: e.dedupeKey, label: "Stop hook" }],
      });

      const files = [...(writesByTurn.get(turnKey(e.actorId, e.turnId)) ?? [])].sort();
      if (files.length > 0) {
        receipts.push({
          id: receiptId("review_ready", e.dedupeKey),
          ...baseFor(e),
          kind: "review_ready",
          title: "Ready for review",
          confidence: "observed",
          occurredAt: e.occurredAt,
          files,
          evidence: [
            { type: "source_event", ref: e.dedupeKey, label: "Stop hook" },
            ...files.map((f) => ({ type: "file_change" as const, ref: f, label: "file written" })),
          ],
        });
      }
      continue;
    }

    if (e.kind !== "activity_completed" && e.kind !== "activity_failed") continue;

    const outcome = bashOutcome(e);
    if (!outcome) continue;
    const { category, exitCode } = outcome;
    const passed = exitCode === 0;
    const command = e.activity?.operation ?? category;
    const kind: ReceiptKind = passed
      ? category === "test"
        ? "test_passed"
        : "build_passed"
      : category === "test"
        ? "test_failed"
        : "build_failed";

    receipts.push({
      id: receiptId(kind, e.dedupeKey),
      ...baseFor(e),
      kind,
      title: `${CATEGORY_LABEL[category]} ${passed ? "passed" : "failed"}: ${command}`,
      confidence: "verified",
      occurredAt: e.occurredAt,
      evidence: [{ type: "exit_code", ref: String(exitCode), label: command }],
    });

    const key = `${turnKey(e.actorId, e.turnId)}:${category}`;
    if (!passed) {
      openFailures.set(key, { exitCode });
      continue;
    }
    const failure = openFailures.get(key);
    if (failure) {
      openFailures.delete(key);
      receipts.push({
        id: receiptId("failure_recovered", e.dedupeKey),
        ...baseFor(e),
        kind: "failure_recovered",
        title: `${CATEGORY_LABEL[category]} recovered: ${command}`,
        // Both sides carry an exit code here — bashOutcome requires one on every tracked event.
        confidence: "verified",
        occurredAt: e.occurredAt,
        evidence: [
          { type: "exit_code", ref: String(failure.exitCode), label: `${command} (failed)` },
          { type: "exit_code", ref: String(exitCode), label: `${command} (passed)` },
        ],
      });
    }
  }

  // ponytail: commit_created needs read-only `git rev-parse HEAD` wired at the server/store
  // level (spec rule 5) — no signal for it inside a pure AgentEvent[] derivation. Add once
  // that IO lands (M2 server wiring), attributing to the actor whose Bash ran the commit.

  return receipts.sort((a, b) => a.occurredAt - b.occurredAt);
};
