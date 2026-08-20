import type { FC } from "react";

import type { AttentionItem } from "#contracts/attention.js";
import type { ActorView } from "#contracts/world.js";

import { AttentionItemCard } from "@/components/molecules/attention-item";

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

type Props = { items: AttentionItem[]; actors: ActorView[] };

export const AttentionDrawer: FC<Props> = ({ items, actors }) => {
  const names = new Map(actors.map((a) => [a.id, a.displayName]));
  const open = sortAttention(items.filter((i) => i.status === "open" || i.status === "acknowledged"));
  return (
    <aside className={styles.drawer} aria-label="Attention queue">
      <h2 className={styles.title}>Needs you</h2>
      {/* Mounted with the first world snapshot (never conditionally added later), so the live
          region already exists for any attention that arrives after that (docs/spec.md "new
          attention uses a polite live region"). */}
      <ol className={styles.list} aria-live="polite">
        {open.length === 0 ? (
          <li className={styles.empty}>Nothing needs you right now.</li>
        ) : (
          open.map((item) => <AttentionItemCard key={item.id} item={item} actorNames={names} />)
        )}
      </ol>
    </aside>
  );
};
