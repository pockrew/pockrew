import { useCallback, useEffect, useState, type FC } from "react";

import { HugeiconsIcon } from "@hugeicons/react";

import type { AttentionItem } from "#contracts/attention.js";
import type { ActorView } from "#contracts/world.js";

import { AttentionItemCard } from "@/components/molecules/attention-item";
import { isOpenAttention } from "@/lib/attention";
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

/** Desktop-width breakpoint: above it the tracker starts open, below it folded. */
const WIDE_SCREEN = "(min-width: 60rem)";

type Props = { items: AttentionItem[]; actors: ActorView[] };

/**
 * Quest tracker: the open attention queue pinned over the world, top-right. Collapses to a badge
 * with the open count. The list stays mounted either way — collapsing must not silence the live
 * region, so it becomes visually hidden instead of unmounting (docs/spec.md: "new attention uses a
 * polite live region").
 */
export const AttentionDrawer: FC<Props> = ({ items, actors }) => {
  // Phones give the tracker ~80% of the screen, so it starts folded there and open on a desktop.
  const [expanded, setExpanded] = useState(() => window.matchMedia(WIDE_SCREEN).matches);
  const handleCollapse = useCallback(() => setExpanded(false), []);
  useEscapeClose(expanded, handleCollapse);
  const names = new Map(actors.map((a) => [a.id, a.displayName]));
  const open = sortAttention(items.filter(isOpenAttention));
  const handleToggle = () => setExpanded((current) => !current);

  useEffect(() => {
    // Crossing the breakpoint re-applies the default for the new width: a window resized down from
    // a desktop must not leave the tracker covering the whole phone-sized screen.
    const query = window.matchMedia(WIDE_SCREEN);
    const handleChange = (event: MediaQueryListEvent) => setExpanded(event.matches);
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  return (
    <aside className={styles.tracker} aria-label="Attention queue" data-expanded={expanded}>
      {/* No aria-expanded: the list stays in the accessibility tree either way, so claiming it is
          collapsed would be a lie. The button shows/hides it visually. */}
      <button type="button" className={styles.toggle} aria-controls="attention-queue-list" onClick={handleToggle}>
        <HugeiconsIcon icon={ATTENTION_META.approval.icon} size={18} aria-hidden="true" />
        <span className={styles.count}>{open.length}</span>
        <span className={styles.label}>needs you</span>
      </button>
      <ol id="attention-queue-list" className={expanded ? styles.list : "visually-hidden"} aria-live="polite">
        {open.length === 0 ? (
          <li className={styles.empty}>Nothing needs you right now.</li>
        ) : (
          open.map((item) => <AttentionItemCard key={item.id} item={item} actorNames={names} />)
        )}
      </ol>
    </aside>
  );
};
