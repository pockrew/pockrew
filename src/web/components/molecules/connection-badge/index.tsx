import type { FC } from "react";

import { HugeiconsIcon } from "@hugeicons/react";

import { CONNECTION_META, type ConnectionStatus } from "@/lib/world-meta";

import styles from "./styles.module.css";

type Props = { status: ConnectionStatus };

/** Stream connection state: icon + label + colour, never colour alone (rules/react.md). */
export const ConnectionBadge: FC<Props> = ({ status }) => {
  const meta = CONNECTION_META[status];
  return (
    <p className={styles.badge} data-connection={status} role="status">
      <HugeiconsIcon icon={meta.icon} size={16} aria-hidden="true" />
      <span>{meta.label}</span>
    </p>
  );
};
