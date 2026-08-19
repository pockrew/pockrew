import type { FC } from "react";

import type { ActorView, WorldState } from "#contracts/world.js";

import { District } from "@/components/organisms/district";
import { STATE_META, STATION_POS } from "@/lib/world-meta";

import styles from "./styles.module.css";

/** Screen-reader mirror of the canvas: same facts, plain list. */
const WorldListMirror: FC<{ world: WorldState; byId: ReadonlyMap<string, ActorView> }> = ({ world, byId }) => (
  <div className="visually-hidden" role="region" aria-label="World overview">
    {world.projects.map((project) => (
      <section key={project.id}>
        <h3>{project.displayName}</h3>
        <ul>
          {world.actors
            .filter((a) => a.projectId === project.id)
            .map((a) => {
              const parent = a.parentActorId ? byId.get(a.parentActorId) : undefined;
              const station = STATION_POS.get(a.station)?.label ?? a.station;
              return (
                <li key={a.id}>
                  {a.displayName}: {STATE_META[a.state].label}, at {station}
                  {parent ? `, helping ${parent.displayName}` : ""}
                </li>
              );
            })}
        </ul>
      </section>
    ))}
  </div>
);

export const World: FC<{ world: WorldState }> = ({ world }) => {
  const byId = new Map(world.actors.map((a) => [a.id, a]));
  return (
    <div className={styles.world}>
      {world.projects.map((project) => (
        <District
          key={project.id}
          project={project}
          actors={world.actors.filter((a) => a.projectId === project.id)}
          byId={byId}
        />
      ))}
      <WorldListMirror world={world} byId={byId} />
    </div>
  );
};
