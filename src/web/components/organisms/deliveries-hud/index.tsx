import { useCallback, useEffect, useState, type FC } from "react";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Warehouse } from "@/components/organisms/warehouse";
import { useEscapeClose } from "@/lib/use-escape-close";
import { WAREHOUSE_ART } from "@/lib/world-art";

import styles from "./styles.module.css";

type Props = Parameters<typeof Warehouse>[0] & {
  /** True while the inspector owns the sheet slot: two bottom sheets must never stack. */
  yieldTo?: boolean;
};

/**
 * The warehouse as a HUD inbox: a thumb-reachable launcher bottom-left with the recent delivery
 * count, and the same delivery list summoned over the world instead of stacked under it. Opening it
 * changes no world state, so the camera stays exactly where the user left it.
 */
export const DeliveriesHud: FC<Props> = ({ receipts, projectNames, now, yieldTo = false }) => {
  const [expanded, setExpanded] = useState(false);
  const handleClose = useCallback(() => setExpanded(false), []);
  useEscapeClose(expanded, handleClose);
  const handleToggle = () => setExpanded((current) => !current);

  useEffect(() => {
    if (yieldTo) setExpanded(false);
  }, [yieldTo]);

  return (
    <>
      <button
        type="button"
        className={styles.launcher}
        aria-expanded={expanded}
        aria-label={`Deliveries: ${receipts.length} recent`}
        onClick={handleToggle}
      >
        <img className={styles.art} src={WAREHOUSE_ART} alt="" aria-hidden="true" />
        <span className={styles.count} aria-hidden="true">
          {receipts.length}
        </span>
      </button>
      {expanded ? (
        <div className={styles.panel}>
          <button type="button" className={styles.close} onClick={handleClose} aria-label="Close deliveries">
            <HugeiconsIcon icon={Cancel01Icon} size={20} aria-hidden="true" />
          </button>
          <Warehouse receipts={receipts} projectNames={projectNames} now={now} />
        </div>
      ) : null}
    </>
  );
};
