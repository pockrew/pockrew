import type { CSSProperties, FC } from "react";

import type { Station } from "#contracts/world.js";

import { STATION_SIZE } from "@/lib/world-meta";

import styles from "./styles.module.css";

type Props = { id: Station; label: string; x: number; y: number };

export const StationSlot: FC<Props> = ({ id, label, x, y }) => (
  <div
    className={styles.station}
    data-station={id}
    style={
      {
        "--station-w": `${STATION_SIZE.width}px`,
        "--station-h": `${STATION_SIZE.height}px`,
        transform: `translate(${x}px, ${y}px)`,
      } as CSSProperties
    }
  >
    <span className={styles.stationLabel}>{label}</span>
  </div>
);
