import type { FC } from "react";

import { HugeiconsIcon } from "@hugeicons/react";

import type { AttentionItem } from "#contracts/attention.js";

import { ATTENTION_META } from "@/lib/world-meta";

import styles from "./styles.module.css";

type Props = { item: AttentionItem; actorNames: ReadonlyMap<string, string> };

export const AttentionItemCard: FC<Props> = ({ item, actorNames }) => {
  const meta = ATTENTION_META[item.type];
  return (
    <li className={styles.item} data-type={item.type}>
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
    </li>
  );
};
