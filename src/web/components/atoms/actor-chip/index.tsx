import type { FC } from "react";

import type { ActorView } from "#contracts/world.js";

import { STATE_META, STATION_POS, STATIONS } from "@/lib/world-meta";

import styles from "./styles.module.css";

type Props = { actor: ActorView; parent?: ActorView; slot: number };

export const ActorChip: FC<Props> = ({ actor, parent, slot }) => {
  const station = STATION_POS.get(actor.station) ?? STATIONS[0]!;
  const meta = STATE_META[actor.state];
  const x = station.x + 6;
  const y = station.y + 34 + slot * 34;
  return (
    <div
      className={actor.parentActorId ? `${styles.chip} ${styles.subagent}` : styles.chip}
      data-state={actor.state}
      style={{ transform: `translate(${x}px, ${y}px)` }}
    >
      <span aria-hidden="true">{meta.icon}</span>
      <span className={styles.name}>{actor.displayName}</span>
      <span className={styles.stateLabel}>{meta.label}</span>
      {parent ? <span className={styles.parentLink}>↳ {parent.displayName}</span> : null}
    </div>
  );
};
