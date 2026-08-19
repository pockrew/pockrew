import type { RawSourceEvent } from "#contracts/events.js";

/**
 * Wrap one line of a Codex rollout JSONL (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl)
 * into a RawSourceEvent. Basic adapter only (M0 decision): lifecycle + turns,
 * confidence capped at observed downstream. Live directory watching lands in M2.
 */
export const fromRolloutLine = (line: string, originRef: string, receivedAt: number): RawSourceEvent | null => {
  let payload: unknown;
  try {
    payload = JSON.parse(line);
  } catch {
    return null; // malformed line: skipped, never fatal
  }
  return { source: "codex", channel: "jsonl", receivedAt, originRef, payload };
};
