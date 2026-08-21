import type { CSSProperties, FC, MouseEvent } from "react";

import { HugeiconsIcon } from "@hugeicons/react";

import { restingBreakdown, type DistrictLayout } from "@/lib/district-layout";
import { STATE_META } from "@/lib/world-meta";

import styles from "./styles.module.css";

type Props = NonNullable<DistrictLayout["cluster"]> & { onToggle: () => void };

/**
 * The resting crowd of a district as one control instead of a long stack. Idle and ended stay
 * separate counts, each with its own icon, label and colour — folding never merges two states into
 * one word. Expanding reveals the individual chips, which carry the per-actor detail.
 */
export const IdleCluster: FC<Props> = ({ x, y, actors, folded, onToggle }) => {
  const groups = restingBreakdown(actors);
  const position = { "--chip-x": `${x}px`, "--chip-y": `${y}px` } as CSSProperties;
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    // Folding is not travelling: keep the click off the district's enter handler.
    event.stopPropagation();
    onToggle();
  };
  return (
    <button type="button" className={styles.cluster} style={position} aria-expanded={!folded} onClick={handleClick}>
      {groups.map((group) => (
        <span key={group.state} className={styles.group} data-state={group.state}>
          <HugeiconsIcon icon={STATE_META[group.state].icon} size={14} aria-hidden="true" />
          {group.count} {STATE_META[group.state].label}
        </span>
      ))}
      <span className={styles.hint}>{folded ? "show" : "fold"}</span>
    </button>
  );
};
