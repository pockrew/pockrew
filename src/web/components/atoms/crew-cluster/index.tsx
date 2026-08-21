import type { CSSProperties, FC, MouseEvent } from "react";

import { HugeiconsIcon } from "@hugeicons/react";

// ?no-inline: a <use href> fragment cannot resolve into a data: URI (same note as actor-chip).
import spritesUrl from "@/assets/sprites.svg?no-inline";
import { restingBreakdown, type CrewCluster as CrewClusterData } from "@/lib/district-layout";
import { ACTOR_ART_BY_SOURCE } from "@/lib/world-art";
import { ACTOR_SPRITE_BY_SOURCE, STATE_META } from "@/lib/world-meta";

import styles from "./styles.module.css";

/** How many overlapped avatars a stack shows before the count badge does the talking. */
const STACK_MAX = 3;

/** `key` stays off the props: React reserves it, the district passes it separately. */
type Props = Omit<CrewClusterData, "key"> & { onOpen: () => void };

/**
 * A folded crowd as one game piece: a few overlapped characters plus a count badge — crowded, not
 * listed. Clicking opens the crew roster drawer, where each member links to its inspector. Idle
 * and ended benches keep per-state icon + label + colour (never a merged word, rules/react.md).
 */
export const CrewCluster: FC<Props> = ({ label, kind, x, y, actors, onOpen }) => {
  const position = { "--chip-x": `${x}px`, "--chip-y": `${y}px` } as CSSProperties;
  const groups = kind === "active" ? [] : restingBreakdown(actors);
  const caption = kind === "active" ? label : groups.map((g) => `${g.count} ${STATE_META[g.state].label}`).join(" · ");
  // A folded crew must never hide that someone in it needs the user (spec: needs-you visibility).
  const urgent = actors.some((a) => a.state === "waiting_user" || a.state === "blocked");
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    // Opening the roster is not travelling: keep the click off the district's enter handler.
    event.stopPropagation();
    onOpen();
  };
  return (
    <button
      type="button"
      className={styles.cluster}
      data-kind={kind}
      data-urgent={urgent || undefined}
      style={position}
      aria-label={`${actors.length} agents — ${caption}${urgent ? ", some need you" : ""}. Open crew roster`}
      onClick={handleClick}
    >
      <span className={styles.stack} aria-hidden="true">
        {actors.slice(0, STACK_MAX).map((actor) => {
          const art = ACTOR_ART_BY_SOURCE[actor.source];
          return art.idle ? (
            <img key={actor.id} className={styles.avatar} src={art.idle} alt="" />
          ) : (
            <svg key={actor.id} className={styles.avatar} viewBox="0 0 32 32">
              <use href={`${spritesUrl}#${ACTOR_SPRITE_BY_SOURCE[actor.source]}`} />
            </svg>
          );
        })}
        <span className={styles.count}>{actors.length}</span>
      </span>
      <span className={styles.caption} aria-hidden="true">
        {kind === "active" ? (
          caption
        ) : (
          <>
            {groups.map((group) => (
              <span key={group.state} className={styles.group} data-state={group.state}>
                <HugeiconsIcon icon={STATE_META[group.state].icon} size={11} aria-hidden="true" />
                {group.count} {STATE_META[group.state].label}
              </span>
            ))}
          </>
        )}
      </span>
    </button>
  );
};
