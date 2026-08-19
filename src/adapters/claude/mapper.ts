import type { RawSourceEvent } from "#contracts/events.js";

/** Wrap one incoming hook POST into a RawSourceEvent. No cleaning here — that is core's job. */
export const fromHookPost = (payload: unknown, receivedAt: number): RawSourceEvent => {
  const hook =
    typeof payload === "object" && payload !== null && "hook_event_name" in payload
      ? String((payload as { hook_event_name: unknown }).hook_event_name)
      : undefined;
  return { source: "claude", channel: "hook", receivedAt, payload, ...(hook !== undefined ? { hook } : {}) };
};
