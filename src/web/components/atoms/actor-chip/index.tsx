import type { CSSProperties, FC, MouseEvent } from "react";

import { HugeiconsIcon } from "@hugeicons/react";

import type { ActorView } from "#contracts/world.js";

// ?no-inline: a <use href> fragment cannot resolve into a data: URI, so the
// sprite sheet must always be emitted as a real file (dev never inlines; build does).
import spritesUrl from "@/assets/sprites.svg?no-inline";
import type { ChipPlacement } from "@/lib/district-layout";
import { ACTOR_SPRITE_BY_SOURCE, STATE_META, STATION_POS } from "@/lib/world-meta";

import styles from "./styles.module.css";

type Props = ChipPlacement & { parent?: ActorView; selected: boolean; onSelect: () => void };

/** A character on the stage. Clicking it inspects the actor, the way a base unit is tapped. */
export const ActorChip: FC<Props> = ({ actor, parent, x, y, spawnDx, spawnDy, selected, onSelect }) => {
  const meta = STATE_META[actor.state];
  const spriteId = ACTOR_SPRITE_BY_SOURCE[actor.source];
  const station = STATION_POS.get(actor.station)?.label ?? actor.station;
  // Position lives in custom properties so the spawn keyframe can offset from it.
  const position = {
    "--chip-x": `${x}px`,
    "--chip-y": `${y}px`,
    "--spawn-dx": `${spawnDx}px`,
    "--spawn-dy": `${spawnDy}px`,
  } as CSSProperties;
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    // Inspecting a character is not travelling to the base: keep it off the district handler.
    event.stopPropagation();
    onSelect();
  };
  return (
    <button
      type="button"
      className={actor.parentActorId ? `${styles.chip} ${styles.subagent}` : styles.chip}
      data-state={actor.state}
      style={position}
      aria-pressed={selected}
      aria-label={`${actor.displayName}, ${actor.source}, ${meta.label}, at ${station}${
        parent ? `, helping ${parent.displayName}` : ""
      } — open inspector`}
      onClick={handleClick}
    >
      <svg className={styles.avatar} viewBox="0 0 32 32" aria-hidden="true">
        <use href={`${spritesUrl}#${spriteId}`} />
      </svg>
      <HugeiconsIcon icon={meta.icon} size={14} aria-hidden="true" />
      <span aria-hidden="true" className={styles.body}>
        <span className={styles.name}>{actor.displayName}</span>
        <span className={styles.stateLabel}>{meta.label}</span>
        {parent ? <span className={styles.parentLink}>↳ {parent.displayName}</span> : null}
      </span>
    </button>
  );
};
