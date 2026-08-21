import { useEffect, useRef, type FC } from "react";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { ActivityView, ActorView, AttentionView, ReceiptView } from "#contracts/world.js";

import { AttentionItemCard } from "@/components/molecules/attention-item";
import { ReceiptDelivery } from "@/components/molecules/receipt-delivery";
import { useEscapeClose } from "@/lib/use-escape-close";
import { CONFIDENCE_META, STATE_META, STATION_LABEL } from "@/lib/world-meta";

import styles from "./styles.module.css";

type Props = {
  actor: ActorView;
  parent?: ActorView;
  activity?: ActivityView;
  receipts: ReceiptView[];
  attention: AttentionView[];
  projectName: string;
  now: number;
  onClose: () => void;
};

/**
 * Inspect one character the way a base unit is tapped: glanceable header first, detail below.
 * Confidence lives here and nowhere on the map (contracts/world.ts: "shown in the inspector only").
 */
export const ActorInspector: FC<Props> = ({
  actor,
  parent,
  activity,
  receipts,
  attention,
  projectName,
  now,
  onClose,
}) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  // Mounted only while open, so it is always the top-most overlay Escape should close.
  useEscapeClose(true, onClose);
  const state = STATE_META[actor.state];
  const confidence = CONFIDENCE_META[actor.stateConfidence];
  const station = STATION_LABEL[actor.station];
  const actorNames = new Map([actor, ...(parent ? [parent] : [])].map((a) => [a.id, a.displayName]));

  useEffect(() => {
    closeRef.current?.focus();
  }, [actor.id]);

  return (
    <aside className={styles.panel} aria-label={`Inspector: ${actor.displayName}`}>
      <header className={styles.header}>
        <h2 className={styles.name}>{actor.displayName}</h2>
        <button ref={closeRef} type="button" className={styles.close} onClick={onClose} aria-label="Close inspector">
          <HugeiconsIcon icon={Cancel01Icon} size={20} aria-hidden="true" />
        </button>
      </header>

      <dl className={styles.facts}>
        <dt>State</dt>
        <dd className={styles.state} data-state={actor.state}>
          <HugeiconsIcon icon={state.icon} size={16} aria-hidden="true" /> {state.label}
          <span className={styles.confidence} data-confidence={actor.stateConfidence}>
            <HugeiconsIcon icon={confidence.icon} size={14} aria-hidden="true" /> {confidence.label}
          </span>
        </dd>
        <dt>Station</dt>
        <dd>{station}</dd>
        <dt>Source</dt>
        <dd>{actor.source}</dd>
        <dt>Project</dt>
        <dd>{projectName}</dd>
        {parent ? (
          <>
            <dt>Helping</dt>
            <dd>{parent.displayName}</dd>
          </>
        ) : null}
        <dt>Activity</dt>
        <dd>
          {activity
            ? `${activity.category}${activity.tool ? ` · ${activity.tool}` : ""}${
                activity.operation ? ` · ${activity.operation}` : ""
              } · ${activity.status}`
            : "unknown"}
        </dd>
      </dl>

      <h3 className={styles.subtitle}>Needs you</h3>
      {attention.length === 0 ? (
        <p className={styles.empty}>Nothing open.</p>
      ) : (
        <ol className={styles.list}>
          {attention.map((item) => (
            <AttentionItemCard key={item.id} item={item} actorNames={actorNames} />
          ))}
        </ol>
      )}

      <h3 className={styles.subtitle}>Deliveries</h3>
      {receipts.length === 0 ? (
        <p className={styles.empty}>No deliveries from this agent yet.</p>
      ) : (
        <ol className={styles.list}>
          {receipts.map((receipt) => (
            <ReceiptDelivery key={receipt.id} receipt={receipt} projectName={projectName} now={now} />
          ))}
        </ol>
      )}
    </aside>
  );
};
