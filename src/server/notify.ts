// OS notifications for the attention queue (spec A10 dedupe): at most one per item, repeated
// after 10 minutes only while the item is still open and still high priority. Runs in the daemon,
// not the web app — the whole point is reaching the user when no Pockrew window is open.
import { execFile } from "node:child_process";

import type { AttentionItem } from "#contracts/attention.js";

export const NOTIFY_REPEAT_MS = 600_000;

const urgent = (item: AttentionItem): boolean => item.priority === "high" || item.priority === "critical";

/**
 * Which items deserve an OS notification at `now`, given when each was last notified. Pure so the
 * rate-limit is testable without a clock or a real notification. Only high/critical items notify
 * at all — normal/info stay in the tracker (spec A11: medium/inferred never notifies by default) —
 * and only while `open`: an acknowledged or snoozed item has been seen, pinging again is spam.
 */
export const dueNotifications = (
  items: AttentionItem[],
  log: ReadonlyMap<string, number>,
  now: number,
): AttentionItem[] =>
  items.filter((item) => {
    if (item.status !== "open" || !urgent(item)) return false;
    const last = log.get(item.id);
    return last === undefined || now - last >= NOTIFY_REPEAT_MS;
  });

/** macOS only for now; other platforms are silently a no-op (the tracker still shows everything). */
const osNotify = (title: string, message: string): void => {
  if (process.platform !== "darwin") return;
  // JSON.stringify escapes quotes/backslashes the way AppleScript string literals expect.
  const script = `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`;
  execFile("osascript", ["-e", script], () => {
    // A failed notification must never take the daemon down; the item stays in the queue anyway.
  });
};

export type Notifier = { check: () => void };

/**
 * `check()` re-derives the queue and notifies what is due. Called on every ingested event (so a
 * permission prompt pings within a second) and from a 60s interval in cli.ts (so the 10-minute
 * repeat fires even when no event arrives). The last-notified log is in-memory on purpose: after
 * a daemon restart, one fresh ping for a still-open high item is correct, not a duplicate.
 */
export const createNotifier = (deps: {
  items: () => AttentionItem[];
  send?: (title: string, message: string) => void;
  now?: () => number;
}): Notifier => {
  const send = deps.send ?? osNotify;
  const now = deps.now ?? Date.now;
  const log = new Map<string, number>();
  return {
    check: (): void => {
      let items: AttentionItem[];
      try {
        items = deps.items();
      } catch {
        return; // a failing store already surfaces through /api/health and coverage
      }
      const at = now();
      for (const item of dueNotifications(items, log, at)) {
        send("Pockrew — needs you", item.summary);
        log.set(item.id, at);
      }
      const alive = new Set(items.map((i) => i.id));
      for (const id of log.keys()) if (!alive.has(id)) log.delete(id); // no unbounded growth
    },
  };
};
