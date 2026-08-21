import type { CSSProperties, FC } from "react";

import type { ActivityView, ActorView, ProjectView } from "#contracts/world.js";

import { ActorChip } from "@/components/atoms/actor-chip";
import { CrewCluster } from "@/components/atoms/crew-cluster";
import { StationSlot } from "@/components/atoms/station-slot";
import { CELL_SIZE, type CrewCluster as CrewClusterData, type DistrictLayout } from "@/lib/district-layout";
import { isArrival } from "@/lib/travel-state";
import { DISTRICT_PLATE_ART } from "@/lib/world-art";
import { districtSize, type DistrictPlacement } from "@/lib/world-layout";

import styles from "./styles.module.css";

type Props = {
  project: ProjectView;
  /** Built by the world, so the plane can pace itself by the widest town it holds. */
  layout: DistrictLayout;
  actorCount: number;
  byId: ReadonlyMap<string, ActorView>;
  /** Activities by id, for each chip's speech bubble (`actor.currentActivityId`). */
  activityById: ReadonlyMap<string, ActivityView>;
  placement: DistrictPlacement;
  /** generatedAt of the first snapshot this tab saw — anything started after it really did arrive. */
  spawnedSince: number;
  selectedActorId?: string;
  onEnter: () => void;
  onFocusEnter: () => void;
  /** A folded crowd was clicked: open its roster drawer. */
  onOpenCrew: (cluster: CrewClusterData) => void;
  onSelectActor: (actor: ActorView) => void;
};

/** One base on the world plane: a nameplate you click to travel to it, plus the town it has built. */
export const District: FC<Props> = ({
  project,
  layout,
  actorCount,
  byId,
  activityById,
  placement,
  spawnedSince,
  selectedActorId,
  onEnter,
  onFocusEnter,
  onOpenCrew,
  onSelectActor,
}) => {
  // Every pixel size comes from the layout; the stylesheet only reads them back. The plate is
  // exactly this town's grid, so the base covers its town and no more.
  const box = {
    "--district-x": `${placement.x}px`,
    "--district-y": `${placement.y}px`,
    "--district-w": `${districtSize(layout.side).width}px`,
    "--stage-w": `${layout.plate.width}px`,
    "--stage-h": `${layout.plate.height}px`,
    "--cell-w": `${CELL_SIZE.width}px`,
    "--cell-h": `${CELL_SIZE.height}px`,
    // The ground the base is built on. Decoration, so it stays a CSS background.
    "--plate-art": `url(${DISTRICT_PLATE_ART})`,
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
          {actorCount} agents · {project.openAttentionCount} attention · {project.verifiedReceiptCount} verified
        </p>
      </header>
      <div className={styles.stage}>
        {/* Roads first: they run under the buildings. Decoration — the town's own street network.
            Drawn as one stroke per street today; layout.roadCells carries the same streets as
            cells + connections for the PNG road tiles, which swap in without touching the layout. */}
        <svg className={styles.paths} aria-hidden="true">
          {layout.roads.map((road) => (
            <path key={road.id} className={styles.road} d={road.d} />
          ))}
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
        {layout.stations.map((s) => (
          <StationSlot key={s.station} station={s.station} label={s.label} x={s.x} y={s.y} />
        ))}
        {layout.chips.map((chip) => {
          const parent = chip.actor.parentActorId ? byId.get(chip.actor.parentActorId) : undefined;
          const activity = chip.actor.currentActivityId ? activityById.get(chip.actor.currentActivityId) : undefined;
          return (
            <ActorChip
              key={chip.actor.id}
              {...chip}
              {...(parent ? { parent } : {})}
              {...(activity ? { activity } : {})}
              selected={chip.actor.id === selectedActorId}
              spawned={isArrival(chip.actor, spawnedSince)}
              routeFrom={layout.travelPath}
              onSelect={() => onSelectActor(chip.actor)}
            />
          );
        })}
        {layout.clusters.map(({ key, ...cluster }) => (
          <CrewCluster key={key} {...cluster} onOpen={() => onOpenCrew({ key, ...cluster })} />
        ))}
      </div>
    </section>
  );
};
