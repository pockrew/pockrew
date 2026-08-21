import type { FC } from "react";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { ActorView } from "#contracts/world.js";

// ?no-inline: a <use href> fragment cannot resolve into a data: URI (same note as actor-chip).
import spritesUrl from "@/assets/sprites.svg?no-inline";
import { personaFor } from "@/lib/persona";
import { useEscapeClose } from "@/lib/use-escape-close";
import { ACTOR_ART_BY_SOURCE } from "@/lib/world-art";
import { ACTOR_SPRITE_BY_SOURCE, STATE_META } from "@/lib/world-meta";

import styles from "./styles.module.css";

type Props = {
  title: string;
  actors: ActorView[];
  onSelect: (actor: ActorView) => void;
  onClose: () => void;
};

/**
 * The crew behind a folded cluster, one row per member: persona, live task line and state
 * (icon + label + colour). Clicking a member opens their full inspector — this drawer is the
 * hallway, the inspector stays the room with the stats.
 */
export const CrewRoster: FC<Props> = ({ title, actors, onSelect, onClose }) => {
  // Mounted only while open, so it is the top-most overlay Escape should close.
  useEscapeClose(true, onClose);
  return (
    <aside className={styles.panel} aria-label={`Crew: ${title}`}>
      <header className={styles.header}>
        <h2 className={styles.title}>
          {title} · {actors.length}
        </h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close crew roster">
          <HugeiconsIcon icon={Cancel01Icon} size={20} aria-hidden="true" />
        </button>
      </header>
      <ol className={styles.list}>
        {actors.map((actor) => {
          const meta = STATE_META[actor.state];
          const art = ACTOR_ART_BY_SOURCE[actor.source];
          return (
            <li key={actor.id}>
              <button type="button" className={styles.row} onClick={() => onSelect(actor)}>
                {art.idle ? (
                  <img className={styles.avatar} src={art.idle} alt="" aria-hidden="true" />
                ) : (
                  <svg className={styles.avatar} viewBox="0 0 32 32" aria-hidden="true">
                    <use href={`${spritesUrl}#${ACTOR_SPRITE_BY_SOURCE[actor.source]}`} />
                  </svg>
                )}
                <span className={styles.who}>
                  <span className={styles.persona}>{personaFor(actor.id, actor.parentActorId !== undefined)}</span>
                  <span className={styles.task}>{actor.displayName}</span>
                </span>
                <span className={styles.state} data-state={actor.state}>
                  <HugeiconsIcon icon={meta.icon} size={13} aria-hidden="true" /> {meta.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
};
