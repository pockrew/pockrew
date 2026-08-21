import type { FC } from "react";

import { CheckmarkBadge01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { ReceiptView } from "#contracts/world.js";

import { formatElapsed } from "@/lib/format-elapsed";
import { CONFIDENCE_META, RECEIPT_KIND_LABEL } from "@/lib/world-meta";

import styles from "./styles.module.css";

type Props = { receipt: ReceiptView; projectName: string; now: number };

/** One warehouse delivery: a receipt rendered glanceable, not inspected. */
export const ReceiptDelivery: FC<Props> = ({ receipt, projectName, now }) => {
  const confidence = CONFIDENCE_META[receipt.confidence];
  return (
    <li className={styles.item} data-confidence={receipt.confidence}>
      <div className={styles.row}>
        <span className={styles.kind}>{RECEIPT_KIND_LABEL[receipt.kind]}</span>
        <div className={styles.status}>
          {receipt.reviewed ? (
            <span className={styles.reviewed}>
              <HugeiconsIcon icon={CheckmarkBadge01Icon} size={14} aria-hidden="true" /> Reviewed
            </span>
          ) : null}
          <span className={styles.confidence}>
            <HugeiconsIcon icon={confidence.icon} size={14} aria-hidden="true" /> {confidence.label}
          </span>
        </div>
      </div>
      <p className={styles.title}>{receipt.title}</p>
      <div className={styles.meta}>
        <span className={styles.project}>{projectName}</span>
        <span className={styles.time}>{formatElapsed(receipt.occurredAt, now)}</span>
      </div>
    </li>
  );
};
