import type { FC } from "react";

import { HugeiconsIcon } from "@hugeicons/react";

import type { AttentionItem } from "#contracts/attention.js";

import { ATTENTION_META } from "@/lib/world-meta";

import styles from "./styles.module.css";

type Props = {
  item: AttentionItem;
  actorNames: ReadonlyMap<string, string>;
  /** Deep-focus: travel the camera to this item's actor and open its inspector. Omitted where the
   *  actor is already in focus (the inspector's own list). */
  onFocus?: (actorId: string) => void;
  onAck?: (id: string) => void;
  onSnooze?: (id: string) => void;
  onResolve?: (id: string) => void;
};

/** Types whose real answer lives in the provider's own terminal/UI — Pockrew only observes. */
const NEEDS_NATIVE_ANSWER = new Set<AttentionItem["type"]>(["approval", "question"]);

export const AttentionItemCard: FC<Props> = ({ item, actorNames, onFocus, onAck, onSnooze, onResolve }) => {
  const meta = ATTENTION_META[item.type];
  const actorId = item.actorIds[0];
  const nativeAnswer = NEEDS_NATIVE_ANSWER.has(item.type);
  const handleFocus = () => actorId !== undefined && onFocus?.(actorId);
  const handleAck = () => onAck?.(item.id);
  const handleSnooze = () => onSnooze?.(item.id);
  const handleResolve = () => onResolve?.(item.id);
  return (
    <li className={styles.item} data-type={item.type} data-status={item.status}>
      <div className={styles.row}>
        <span className={styles.type}>
          <HugeiconsIcon icon={meta.icon} size={14} aria-hidden="true" /> {meta.label}
        </span>
        <span className={styles.priority} data-priority={item.priority}>
          {item.priority}
        </span>
      </div>
      <span className={styles.actor}>{item.actorIds.map((id) => actorNames.get(id) ?? id).join(", ")}</span>
      <p className={styles.summary}>{item.summary}</p>
      {nativeAnswer ? (
        // Honesty over convenience: the Claude adapter can only observe approvals (a deny leaves
        // no event — data-notes §2), so Pockrew must say where the real answer happens instead of
        // pretending a click here answers the prompt.
        <p className={styles.hint}>Answer in its own terminal — Pockrew can’t respond for the agent yet.</p>
      ) : null}
      <div className={styles.actions}>
        {/* Approve/Deny is deliberately absent: the Claude adapter's `approvals` capability is
            "observe" — a deny leaves no signal (data-notes §2), so the honest action is to focus
            the actor and answer in the native terminal (spec "Approval safety"). */}
        {onFocus && actorId !== undefined ? (
          <button type="button" className={styles.action} onClick={handleFocus}>
            Focus
          </button>
        ) : null}
        {onAck && item.status === "open" ? (
          <button type="button" className={styles.action} onClick={handleAck}>
            Ack
          </button>
        ) : null}
        {onSnooze ? (
          <button type="button" className={styles.action} onClick={handleSnooze}>
            Snooze 10m
          </button>
        ) : null}
        {onResolve ? (
          <button type="button" className={styles.action} onClick={handleResolve}>
            {/* An approval/question is answered in the terminal; here you can only clear the card. */}
            {nativeAnswer ? "Dismiss" : "Resolve"}
          </button>
        ) : null}
      </div>
    </li>
  );
};
