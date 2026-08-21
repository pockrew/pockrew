import { useEffect, useRef, useState, type CSSProperties, type FC, type MouseEvent } from "react";

import { HugeiconsIcon } from "@hugeicons/react";

import type { ActorView, Station } from "#contracts/world.js";

// ?no-inline: a <use href> fragment cannot resolve into a data: URI, so the
// sprite sheet must always be emitted as a real file (dev never inlines; build does).
import spritesUrl from "@/assets/sprites.svg?no-inline";
import type { ChipPlacement, Travel } from "@/lib/district-layout";
import { entryTrip, nextTravel, settleTravel } from "@/lib/travel-state";
import { ACTOR_ART_BY_SOURCE } from "@/lib/world-art";
import { ACTOR_SPRITE_BY_SOURCE, STATE_META, STATION_LABEL } from "@/lib/world-meta";

import styles from "./styles.module.css";

/**
 * Backstop longer than the slowest walk (--dur-move x the 3x factor cap); the animation itself ends
 * earlier, and under reduced motion it is instant and the chip already sits at the end.
 */
const WALK_BACKSTOP_MS = 1_200;

type Props = ChipPlacement & {
  parent?: ActorView;
  selected: boolean;
  /** True only for a character that really turned up while watching (lib/travel-state `isArrival`). */
  spawned: boolean;
  /** Walk route from the actor's previous station to this chip's spot, or null when there is none. */
  routeFrom: (from: Station, to: { x: number; y: number }) => Travel | null;
  onSelect: () => void;
};

/** A character on the stage. Clicking it inspects the actor, the way a base unit is tapped. */
export const ActorChip: FC<Props> = ({
  actor,
  parent,
  x,
  y,
  spawnDx,
  spawnDy,
  selected,
  spawned,
  routeFrom,
  onSelect,
}) => {
  // District rebuilds its layout every render, so `routeFrom` is a fresh closure each time and the
  // resting spot can shift under the chip. Both live in one ref, re-pointed on every render, so the
  // route effect depends on the station alone — a new closure must never restart a walk.
  const routeToSpot = useRef<(from: Station) => Travel | null>((from) => routeFrom(from, { x, y }));
  routeToSpot.current = (from) => routeFrom(from, { x, y });
  // A character that really just arrived enters through the anchor: it mounts on the HQ cell already
  // walking the road out to its station. Anyone else — a remount after a reload, a chip the idle fold
  // just revealed — simply stands where it already is. Reduced motion makes the walk a teleport.
  const [trip, setTrip] = useState(() => entryTrip(actor.station, spawned, routeToSpot.current));
  // The pop-in belongs to the arrival alone. Once the chip has walked anywhere the entrance is over,
  // so the spawn keyframe is dropped — otherwise every settled trip would pop the character in again.
  const walked = useRef(false);
  walked.current = walked.current || trip.travel !== null;
  const travel: Travel | null = trip.travel;
  const meta = STATE_META[actor.state];
  const art = ACTOR_ART_BY_SOURCE[actor.source];
  const spriteId = ACTOR_SPRITE_BY_SOURCE[actor.source];
  const station = STATION_LABEL[actor.station];
  const position = {
    // Position lives in custom properties so the spawn keyframe can offset from it.
    "--chip-x": `${x}px`,
    "--chip-y": `${y}px`,
    "--spawn-dx": `${spawnDx}px`,
    "--spawn-dy": `${spawnDy}px`,
    ...(travel ? { "--road-path": `path("${travel.d}")`, "--travel-scale": `${travel.factor}` } : {}),
  } as CSSProperties;
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    // Inspecting a character is not travelling to the base: keep it off the district handler.
    event.stopPropagation();
    onSelect();
  };

  // Walk the road instead of blinking across the plate. No road (station gone) falls back to the
  // plain transform transition; reduced motion zeroes --dur-move, so the walk becomes a teleport.
  useEffect(() => {
    setTrip((previous) => nextTravel(previous, actor.station, routeToSpot.current));
  }, [actor.station]);

  // The backstop owns its own effect, keyed on the trip: a re-render that changes nothing returns
  // the same trip object, so the timer is never cleared without being re-armed.
  useEffect(() => {
    if (!trip.travel) return;
    const done = setTimeout(() => setTrip(settleTravel), WALK_BACKSTOP_MS);
    return () => clearTimeout(done);
  }, [trip]);

  return (
    <button
      type="button"
      className={actor.parentActorId ? `${styles.chip} ${styles.subagent}` : styles.chip}
      data-state={actor.state}
      data-moving={travel ? "true" : undefined}
      data-entering={spawned && !walked.current ? "true" : undefined}
      style={position}
      aria-pressed={selected}
      aria-label={`${actor.displayName}, ${actor.source}, ${meta.label}, at ${station}${
        parent ? `, helping ${parent.displayName}` : ""
      } — open inspector`}
      onClick={handleClick}
    >
      {/* Character art when the source has a PNG; the SVG sprite stands in until it does. */}
      {art.idle ? (
        <img className={styles.avatar} src={art.idle} alt="" aria-hidden="true" />
      ) : (
        <svg className={styles.avatar} viewBox="0 0 32 32" aria-hidden="true">
          <use href={`${spritesUrl}#${spriteId}`} />
        </svg>
      )}
      <HugeiconsIcon icon={meta.icon} size={14} aria-hidden="true" />
      <span aria-hidden="true" className={styles.body}>
        <span className={styles.name}>{actor.displayName}</span>
        <span className={styles.stateLabel}>{meta.label}</span>
        {parent ? <span className={styles.parentLink}>↳ {parent.displayName}</span> : null}
      </span>
    </button>
  );
};
