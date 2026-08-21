import type { FC } from "react";

import type { ReceiptView } from "#contracts/world.js";

import { ReceiptDelivery } from "@/components/molecules/receipt-delivery";
import { WAREHOUSE_ART } from "@/lib/world-art";

import styles from "./styles.module.css";

type Props = { receipts: ReceiptView[]; projectNames: ReadonlyMap<string, string>; now: number };

/** World mapping: work receipts render as warehouse deliveries (docs/spec.md "World mapping"). */
export const Warehouse: FC<Props> = ({ receipts, projectNames, now }) => {
  return (
    <section className={styles.warehouse} aria-label="Warehouse deliveries">
      <h2 className={styles.title}>
        {/* Decoration: the heading text is what AT reads. */}
        <img className={styles.art} src={WAREHOUSE_ART} alt="" aria-hidden="true" />
        Deliveries
      </h2>
      {receipts.length === 0 ? (
        <p className={styles.empty}>No deliveries yet.</p>
      ) : (
        <ol className={styles.list}>
          {receipts.map((receipt) => (
            <ReceiptDelivery
              key={receipt.id}
              receipt={receipt}
              projectName={projectNames.get(receipt.projectId) ?? receipt.projectId}
              now={now}
            />
          ))}
        </ol>
      )}
    </section>
  );
};
