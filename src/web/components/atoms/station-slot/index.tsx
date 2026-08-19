import type { FC } from "react";

import type { Station } from "#contracts/world.js";

import styles from "./styles.module.css";

type Props = { id: Station; label: string; x: number; y: number };

export const StationSlot: FC<Props> = ({ id, label, x, y }) => (
  <div className={styles.station} data-station={id} style={{ transform: `translate(${x}px, ${y}px)` }}>
    <span className={styles.stationLabel}>{label}</span>
  </div>
);
