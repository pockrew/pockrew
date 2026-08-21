import { useCallback, useEffect, useRef, useState, type FC } from "react";

import { HugeiconsIcon } from "@hugeicons/react";

import type { AttentionItem } from "#contracts/attention.js";
import type { UserIntent } from "#contracts/intents.js";
import type { ActorView } from "#contracts/world.js";

import { AttentionItemCard } from "@/components/molecules/attention-item";
import { isOpenAttention, SNOOZE_MS } from "@/lib/attention";
import { useEscapeClose } from "@/lib/use-escape-close";
import { ATTENTION_META } from "@/lib/world-meta";

import styles from "./styles.module.css";

const PRIORITY_RANK: Record<AttentionItem["priority"], number> = {
  critical: 0,
  high: 1,
  normal: 2,
  info: 3,
};

/** Approval and error first, then priority, then oldest. */
const sortAttention = (items: AttentionItem[]): AttentionItem[] => {
  const urgency = (item: AttentionItem) => (item.type === "approval" || item.type === "error" ? 0 : 1);
  return [...items].sort(
    (a, b) =>
      urgency(a) - urgency(b) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.openedAt - b.openedAt,
  );
};

const isUrgent = (item: AttentionItem): boolean => item.priority === "critical" || item.priority === "high";

/** Desktop-width breakpoint: above it the tracker starts open, below it folded. */
const WIDE_SCREEN = "(min-width: 60rem)";

type Props = {
  items: AttentionItem[];
  actors: ActorView[];
  onIntent: (intent: Extract<UserIntent, { kind: `attention_${string}` }>) => void;
  onFocusActor: (actorId: string) => void;
};

/**
 * Quest tracker: the open attention queue pinned over the world, top-right. Collapses to a badge
 * with the open count. The list stays mounted either way — collapsing must not silence the live
 * regions, so it becomes visually hidden instead of unmounting. Announcements come from two
 * dedicated hidden regions, never the list itself (which would double-speak every arrival):
 * polite for a new normal/info item (docs/spec.md: "new attention uses a polite live region"),
 * assertive for high/critical — an approval interrupts the reader the way it interrupts the agent.
 */
export const AttentionDrawer: FC<Props> = ({ items, actors, onIntent, onFocusActor }) => {
  // Phones give the tracker ~80% of the screen, so it starts folded there and open on a desktop.
  const [expanded, setExpanded] = useState(() => window.matchMedia(WIDE_SCREEN).matches);
  const [alertText, setAlertText] = useState("");
  const [noticeText, setNoticeText] = useState("");
  /** Item ids already announced; null until the first snapshot so a reload never re-alerts. */
  const announcedRef = useRef<Set<string> | null>(null);
  const handleCollapse = useCallback(() => setExpanded(false), []);
  useEscapeClose(expanded, handleCollapse);
  const names = new Map(actors.map((a) => [a.id, a.displayName]));
  const open = sortAttention(items.filter(isOpenAttention));
  const handleToggle = () => setExpanded((current) => !current);
  const handleFocus = (actorId: string) => onFocusActor(actorId);
  const handleAck = (id: string) => onIntent({ kind: "attention_ack", id });
  const handleResolve = (id: string) => onIntent({ kind: "attention_resolve", id });
  const handleSnooze = (id: string) => onIntent({ kind: "attention_snooze", id, until: Date.now() + SNOOZE_MS });

  useEffect(() => {
    // Crossing the breakpoint re-applies the default for the new width: a window resized down from
    // a desktop must not leave the tracker covering the whole phone-sized screen.
    const query = window.matchMedia(WIDE_SCREEN);
    const handleChange = (event: MediaQueryListEvent) => setExpanded(event.matches);
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    const openItems = items.filter((item) => item.status === "open");
    if (announcedRef.current === null) {
      announcedRef.current = new Set(openItems.map((item) => item.id)); // first snapshot is not news
      return;
    }
    const announced = announcedRef.current;
    const fresh = openItems.filter((item) => !announced.has(item.id));
    for (const item of openItems) announced.add(item.id);
    const say = (item: AttentionItem) => `Needs you: ${ATTENTION_META[item.type].label} — ${item.summary}`;
    const urgent = fresh.filter(isUrgent).at(-1);
    const quiet = fresh.filter((item) => !isUrgent(item)).at(-1);
    if (urgent) setAlertText(say(urgent));
    if (quiet) setNoticeText(say(quiet));
  }, [items]);

  return (
    <aside className={styles.tracker} aria-label="Attention queue" data-expanded={expanded}>
      {/* No aria-expanded: the list stays in the accessibility tree either way, so claiming it is
          collapsed would be a lie. The button shows/hides it visually. */}
      <button type="button" className={styles.toggle} aria-controls="attention-queue-list" onClick={handleToggle}>
        <HugeiconsIcon icon={ATTENTION_META.approval.icon} size={18} aria-hidden="true" />
        <span className={styles.count}>{open.length}</span>
        <span className={styles.label}>needs you</span>
      </button>
      <div className="visually-hidden" role="alert">
        {alertText}
      </div>
      <div className="visually-hidden" aria-live="polite">
        {noticeText}
      </div>
      {/* No aria-live on the list: the regions above announce arrivals exactly once each. */}
      <ol id="attention-queue-list" className={expanded ? styles.list : "visually-hidden"}>
        {open.length === 0 ? (
          <li className={styles.empty}>Nothing needs you right now.</li>
        ) : (
          open.map((item) => (
            <AttentionItemCard
              key={item.id}
              item={item}
              actorNames={names}
              onFocus={handleFocus}
              onAck={handleAck}
              onSnooze={handleSnooze}
              onResolve={handleResolve}
            />
          ))
        )}
      </ol>
    </aside>
  );
};
