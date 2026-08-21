import type { CSSProperties, FC } from "react";

import type { StationPlacement } from "@/lib/district-layout";
import { STATION_ART } from "@/lib/world-art";

import styles from "./styles.module.css";

type Props = Pick<StationPlacement, "station" | "label" | "x" | "y">;

/**
 * A building standing on the plate — no plot, no frame. Its name is a small nameplate that grows to
 * the full label on hover; the full text is always in the DOM, so hovering never re-fetches it.
 *
 * Nothing here is readable: the world list mirror already announces "Stations built: …" per district
 * (organisms/world), so a readable nameplate would announce every station twice.
 */
export const StationSlot: FC<Props> = ({ station, label, x, y }) => (
  <div
    className={styles.station}
    data-station={station}
    style={{ transform: `translate(${x}px, ${y}px)` } as CSSProperties}
  >
    {/* Nameplate above the building: the chips stand at its foot and would cover it below. */}
    <span className={styles.nameplate} aria-hidden="true">
      {label}
    </span>
    <img className={styles.art} src={STATION_ART[station]} alt="" aria-hidden="true" />
  </div>
);
