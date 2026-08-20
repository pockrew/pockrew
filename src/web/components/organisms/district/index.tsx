import type { CSSProperties, FC } from "react";

import type { ActorView, ProjectView } from "#contracts/world.js";

import { ActorChip } from "@/components/atoms/actor-chip";
import { IdleCluster } from "@/components/atoms/idle-cluster";
import { StationSlot } from "@/components/atoms/station-slot";
import { layoutDistrict } from "@/lib/district-layout";
import { DISTRICT_SIZE, STAGE_SIZE, type DistrictPlacement } from "@/lib/world-layout";
import { STATIONS } from "@/lib/world-meta";

import styles from "./styles.module.css";

type Props = {
  project: ProjectView;
  actors: ActorView[];
  byId: ReadonlyMap<string, ActorView>;
  placement: DistrictPlacement;
  idleExpanded: boolean;
  selectedActorId?: string;
  onEnter: () => void;
  onFocusEnter: () => void;
  onToggleIdle: () => void;
  onSelectActor: (actor: ActorView) => void;
};

/** One base on the world plane: a nameplate you click to travel to it, plus its stations. */
export const District: FC<Props> = ({
  project,
  actors,
  byId,
  placement,
  idleExpanded,
  selectedActorId,
  onEnter,
  onFocusEnter,
  onToggleIdle,
  onSelectActor,
}) => {
  const layout = layoutDistrict(actors, idleExpanded);
  // Every pixel size comes from the layout constants; the stylesheet only reads them back.
  const box = {
    "--district-x": `${placement.x}px`,
    "--district-y": `${placement.y}px`,
    "--district-w": `${DISTRICT_SIZE.width}px`,
    "--stage-w": `${STAGE_SIZE.width}px`,
    "--stage-h": `${STAGE_SIZE.height}px`,
  } as CSSProperties;
  return (
    <section className={styles.district} style={box} aria-label={`District ${project.displayName}`} onClick={onEnter}>
      <header className={styles.header}>
        <h2 className={styles.title}>
          {/* The nameplate is the keyboard route into the base; clicking the plot does the same.
              onFocus travels too, so tabbing to an off-screen base brings the camera along. */}
          <button type="button" className={styles.plaque} onClick={onEnter} onFocus={onFocusEnter}>
            {project.displayName}
          </button>
        </h2>
        <p className={styles.counts}>
          {actors.length} agents · {project.openAttentionCount} attention · {project.verifiedReceiptCount} verified
        </p>
      </header>
      <div className={styles.stage}>
        {STATIONS.map((s) => (
          <StationSlot key={s.id} id={s.id} label={s.label} x={s.x} y={s.y} />
        ))}
        {/* Supplementary: the chips already carry icon + label + colour on their own. */}
        <svg className={styles.links} aria-hidden="true">
          {layout.links.map((link) => (
            <line
              key={link.id}
              className={link.active ? `${styles.link} ${styles.flowing}` : styles.link}
              x1={link.x1}
              y1={link.y1}
              x2={link.x2}
              y2={link.y2}
            />
          ))}
        </svg>
        {layout.chips.map((chip) => {
          const parent = chip.actor.parentActorId ? byId.get(chip.actor.parentActorId) : undefined;
          return (
            <ActorChip
              key={chip.actor.id}
              {...chip}
              {...(parent ? { parent } : {})}
              selected={chip.actor.id === selectedActorId}
              onSelect={() => onSelectActor(chip.actor)}
            />
          );
        })}
        {layout.cluster ? <IdleCluster {...layout.cluster} onToggle={onToggleIdle} /> : null}
      </div>
    </section>
  );
};
