import type { FC } from "react";

import type { ActorView, ProjectView, Station } from "#contracts/world.js";

import { ActorChip } from "@/components/atoms/actor-chip";
import { StationSlot } from "@/components/atoms/station-slot";
import { STATIONS } from "@/lib/world-meta";

import styles from "./styles.module.css";

type Props = { project: ProjectView; actors: ActorView[]; byId: ReadonlyMap<string, ActorView> };

export const District: FC<Props> = ({ project, actors, byId }) => {
  // Stack actors sharing a station instead of overlapping them.
  const slotTaken = new Map<Station, number>();
  return (
    <section className={styles.district} aria-label={`District ${project.displayName}`}>
      <header className={styles.header}>
        <h2 className={styles.title}>{project.displayName}</h2>
        <p className={styles.counts}>
          {actors.length} agents · {project.openAttentionCount} attention · {project.verifiedReceiptCount} verified
        </p>
      </header>
      <div className={styles.stage}>
        {STATIONS.map((s) => (
          <StationSlot key={s.id} id={s.id} label={s.label} x={s.x} y={s.y} />
        ))}
        {actors.map((actor) => {
          const slot = slotTaken.get(actor.station) ?? 0;
          slotTaken.set(actor.station, slot + 1);
          const parent = actor.parentActorId ? byId.get(actor.parentActorId) : undefined;
          return <ActorChip key={actor.id} actor={actor} {...(parent ? { parent } : {})} slot={slot} />;
        })}
      </div>
    </section>
  );
};
