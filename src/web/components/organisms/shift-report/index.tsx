import { useCallback, useEffect, useRef, useState, type FC, type KeyboardEvent, type MouseEvent } from "react";

import {
  AlertCircleIcon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  CheckmarkBadge01Icon,
  Loading03Icon,
  PartyIcon,
  Satellite01Icon,
  Time02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { UserIntent } from "#contracts/intents.js";
import type { WorkReceipt } from "#contracts/receipts.js";
import type { ShiftReport as ShiftReportData } from "#contracts/reports.js";
import type { ActorView, ReceiptView } from "#contracts/world.js";

import { AttentionItemCard } from "@/components/molecules/attention-item";
import { SNOOZE_MS } from "@/lib/attention";
import { formatClockTime, formatElapsed } from "@/lib/format-elapsed";
import { reportHasNews } from "@/lib/report-news";
import { getStreamToken } from "@/lib/token";
import { useEscapeClose } from "@/lib/use-escape-close";
import { useReturnDetection } from "@/lib/use-return-detection";
import { CONFIDENCE_META, RECEIPT_KIND_LABEL } from "@/lib/world-meta";

import styles from "./styles.module.css";

type ReceiptRowProps = {
  receipt: WorkReceipt;
  now: number;
  isExpanded: boolean;
  isReviewed: boolean;
  onToggleExpand: () => void;
  onMarkReviewed: (id: string) => void;
};

/** One receipt row inside the shift report with expandable summary, files, and evidence. */
const ReceiptRow: FC<ReceiptRowProps> = ({ receipt, now, isExpanded, isReviewed, onToggleExpand, onMarkReviewed }) => {
  const confidence = CONFIDENCE_META[receipt.confidence];
  const fileCount = receipt.files?.length ?? 0;
  const handleReviewClick = (event: MouseEvent) => {
    event.stopPropagation();
    onMarkReviewed(receipt.id);
  };
  return (
    <li className={styles.receiptItem} data-confidence={receipt.confidence}>
      <button type="button" className={styles.receiptSummaryRow} onClick={onToggleExpand} aria-expanded={isExpanded}>
        <div className={styles.receiptMain}>
          <span className={styles.receiptKind}>{RECEIPT_KIND_LABEL[receipt.kind]}</span>
          <span className={styles.receiptTitle}>{receipt.title}</span>
        </div>
        <div className={styles.receiptMeta}>
          {isReviewed ? (
            <span className={styles.reviewedBadge}>
              <HugeiconsIcon icon={CheckmarkBadge01Icon} size={14} aria-hidden="true" /> Reviewed ✓
            </span>
          ) : null}
          {fileCount > 0 ? (
            <span className={styles.fileCountBadge}>
              {fileCount} {fileCount === 1 ? "file" : "files"}
            </span>
          ) : null}
          <span className={styles.confidenceBadge} data-confidence={receipt.confidence}>
            <HugeiconsIcon icon={confidence.icon} size={14} aria-hidden="true" /> {confidence.label}
          </span>
          <span className={styles.timeBadge}>{formatElapsed(receipt.occurredAt, now)}</span>
          <span className={styles.expandIcon} aria-hidden="true">
            <HugeiconsIcon icon={isExpanded ? ArrowUp01Icon : ArrowDown01Icon} size={14} />
          </span>
        </div>
      </button>
      {isExpanded ? (
        <div className={styles.receiptDetail}>
          {receipt.summary ? <p className={styles.summaryText}>{receipt.summary}</p> : null}
          {receipt.files && receipt.files.length > 0 ? (
            <div className={styles.detailSection}>
              <span className={styles.detailLabel}>Files</span>
              <ul className={styles.filesList}>
                {receipt.files.map((file) => (
                  <li key={file}>
                    <code>{file}</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className={styles.detailSection}>
            <span className={styles.detailLabel}>Evidence</span>
            {receipt.evidence.length === 0 ? (
              <p className={styles.empty}>—</p>
            ) : (
              <ul className={styles.evidenceList}>
                {receipt.evidence.map((ev, idx) => (
                  <li key={idx} className={styles.evidenceRow}>
                    <span className={styles.evidenceLabel}>{ev.label}</span>
                    <span className={styles.evidenceType}>{ev.type}</span>
                    <code className={styles.evidenceRef}>{ev.ref}</code>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className={styles.detailActions}>
            {isReviewed ? (
              <span className={styles.reviewedConfirmed}>
                <HugeiconsIcon icon={CheckmarkBadge01Icon} size={16} aria-hidden="true" /> Reviewed ✓
              </span>
            ) : (
              <button type="button" className={styles.markReviewedButton} onClick={handleReviewClick}>
                <HugeiconsIcon icon={CheckmarkBadge01Icon} size={16} aria-hidden="true" /> Mark reviewed
              </button>
            )}
          </div>
        </div>
      ) : null}
    </li>
  );
};

type Props = {
  actors: ActorView[];
  projectNames: ReadonlyMap<string, string>;
  now: number;
  recentReceipts: ReceiptView[];
  onIntent: (intent: UserIntent) => void;
};

/**
 * Shift Report organism: "Since you left" HUD chip opening a full-overlay report dialog.
 * Follows spec §Shift Report: 6 sections in contract order with deterministic evidence.
 */
export const ShiftReport: FC<Props> = ({ actors, projectNames, now, recentReceipts, onIntent }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ShiftReportData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [expandedReceiptId, setExpandedReceiptId] = useState<string | null>(null);
  const [reviewedReceiptIds, setReviewedReceiptIds] = useState<Set<string>>(() => new Set());

  const launcherRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const requestSeq = useRef(0);

  const handleOpen = useCallback(() => {
    const seq = ++requestSeq.current;
    setOpen(true);
    setLoading(true);
    setErrorMessage(null);
    const token = getStreamToken();
    if (!token) {
      setLoading(false);
      setErrorMessage("Stream token rejected — reopen Pockrew from the daemon link.");
      return;
    }
    void fetch("/api/report", {
      headers: { "x-pockrew-token": token },
    })
      .then(async (res) => {
        if (!res.ok) {
          const message =
            res.status === 401 || res.status === 403
              ? "Stream token rejected — reopen Pockrew from the daemon link."
              : "Unable to load shift report.";
          throw new Error(message);
        }
        const data = (await res.json()) as ShiftReportData;
        if (seq !== requestSeq.current) return;
        setReport(data);
        setErrorMessage(null);
      })
      .catch((err: unknown) => {
        if (seq !== requestSeq.current) return;
        setReport(null);
        setErrorMessage(err instanceof Error ? err.message : "Unable to load shift report.");
      })
      .finally(() => {
        if (seq !== requestSeq.current) return;
        setLoading(false);
      });
  }, []);

  const handleClose = useCallback(() => {
    if (report) {
      onIntent({ kind: "report_seen", cursor: report.to });
    }
    setOpen(false);
    launcherRef.current?.focus();
  }, [report, onIntent]);

  const handleLauncherClick = useCallback(() => {
    if (open) {
      handleClose();
    } else {
      handleOpen();
    }
  }, [open, handleClose, handleOpen]);

  const handleModalKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || !modalRef.current) return;
    const focusable = modalRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey) {
      if (document.activeElement === first || !modalRef.current.contains(document.activeElement)) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last || !modalRef.current.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    }
  }, []);

  const actorNames = new Map(actors.map((a) => [a.id, a.displayName]));
  const isReceiptReviewed = (id: string) =>
    reviewedReceiptIds.has(id) || recentReceipts.find((r) => r.id === id)?.reviewed === true;
  const hasProblems =
    report &&
    (report.problems.blindWindows.length > 0 ||
      report.problems.failures.length > 0 ||
      report.problems.errors.length > 0 ||
      report.problems.recoveries.length > 0);

  const handleToggleExpand = (id: string) => {
    setExpandedReceiptId((curr) => (curr === id ? null : id));
  };

  useEscapeClose(open, handleClose);
  useReturnDetection(handleOpen);
  const handleMarkReviewed = (id: string) => {
    setReviewedReceiptIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    onIntent({ kind: "receipt_mark_reviewed", id });
  };
  const handleAckAttention = (id: string) => onIntent({ kind: "attention_ack", id });
  const handleResolveAttention = (id: string) => onIntent({ kind: "attention_resolve", id });
  const handleSnoozeAttention = (id: string) =>
    onIntent({ kind: "attention_snooze", id, until: Date.now() + SNOOZE_MS });

  useEffect(() => {
    if (open) {
      closeRef.current?.focus();
    }
  }, [open]);

  // Spec Return trigger 3: on (re)start with new events since lastSeenAt, the report opens
  // itself. A quiet probe on mount — nothing renders unless the window actually holds news;
  // a failed probe stays silent (the "Since you left" chip is always there as the manual path).
  useEffect(() => {
    const seq = ++requestSeq.current;
    const token = getStreamToken();
    if (!token) return;
    void fetch("/api/report", { headers: { "x-pockrew-token": token } })
      .then(async (res) => (res.ok ? ((await res.json()) as ShiftReportData) : null))
      .then((data) => {
        if (!data || seq !== requestSeq.current || !reportHasNews(data)) return;
        setReport(data);
        setOpen(true);
      })
      .catch(() => undefined);
  }, []);

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        className={styles.launcher}
        onClick={handleLauncherClick}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Since you left"
      >
        <HugeiconsIcon icon={Time02Icon} size={16} aria-hidden="true" />
        <span>Since you left</span>
      </button>

      {open ? (
        <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="shift-report-title">
          <div ref={modalRef} className={styles.modal} onKeyDown={handleModalKeyDown}>
            <header className={styles.header}>
              <div>
                <h2 id="shift-report-title" className={styles.title}>
                  Shift Report
                </h2>
                {report ? (
                  <p className={styles.timeWindow}>
                    {formatClockTime(report.from)} – {formatClockTime(report.to)}
                  </p>
                ) : null}
              </div>
              <button
                ref={closeRef}
                type="button"
                className={styles.close}
                onClick={handleClose}
                aria-label="Close shift report"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={20} aria-hidden="true" />
              </button>
            </header>

            {loading ? (
              <div className={styles.loading}>
                <HugeiconsIcon icon={Loading03Icon} size={20} aria-hidden="true" />
                <span>Loading shift report…</span>
              </div>
            ) : !report ? (
              <div className={styles.error}>
                <HugeiconsIcon icon={AlertCircleIcon} size={20} aria-hidden="true" />
                <span>{errorMessage ?? "Unable to load shift report."}</span>
              </div>
            ) : (
              <div className={styles.content}>
                {/* 1. Needs You Now */}
                <section className={styles.section} aria-labelledby="heading-needs-you-now">
                  <h3 id="heading-needs-you-now" className={styles.sectionTitle}>
                    Needs You Now
                  </h3>
                  {report.needsYouNow.length === 0 ? (
                    <p className={styles.empty}>—</p>
                  ) : (
                    <ol className={styles.attentionList}>
                      {report.needsYouNow.map((item) => (
                        <AttentionItemCard
                          key={item.id}
                          item={item}
                          actorNames={actorNames}
                          onAck={handleAckAttention}
                          onSnooze={handleSnoozeAttention}
                          onResolve={handleResolveAttention}
                        />
                      ))}
                    </ol>
                  )}
                </section>

                {/* 2. Shipped */}
                <section className={styles.section} aria-labelledby="heading-shipped">
                  <h3 id="heading-shipped" className={styles.sectionTitle}>
                    Shipped
                  </h3>
                  {/* The sentence IS the section's empty state (spec wording beats the dash convention). */}
                  {report.noVerifiedOutcome ? <p className={styles.noOutcome}>{report.noVerifiedOutcome}</p> : null}
                  {report.shipped.length === 0 ? (
                    !report.noVerifiedOutcome ? (
                      <p className={styles.empty}>—</p>
                    ) : null
                  ) : (
                    <ol className={styles.receiptList}>
                      {report.shipped.map((receipt) => (
                        <ReceiptRow
                          key={receipt.id}
                          receipt={receipt}
                          now={now}
                          isExpanded={expandedReceiptId === receipt.id}
                          isReviewed={isReceiptReviewed(receipt.id)}
                          onToggleExpand={() => handleToggleExpand(receipt.id)}
                          onMarkReviewed={handleMarkReviewed}
                        />
                      ))}
                    </ol>
                  )}
                </section>

                {/* 3. Completed Activity */}
                <section className={styles.section} aria-labelledby="heading-completed-activity">
                  <h3 id="heading-completed-activity" className={styles.sectionTitle}>
                    Completed Activity
                  </h3>
                  {report.completedActivity.length === 0 ? (
                    <p className={styles.empty}>—</p>
                  ) : (
                    <ol className={styles.receiptList}>
                      {report.completedActivity.map((receipt) => (
                        <ReceiptRow
                          key={receipt.id}
                          receipt={receipt}
                          now={now}
                          isExpanded={expandedReceiptId === receipt.id}
                          isReviewed={isReceiptReviewed(receipt.id)}
                          onToggleExpand={() => handleToggleExpand(receipt.id)}
                          onMarkReviewed={handleMarkReviewed}
                        />
                      ))}
                    </ol>
                  )}
                </section>

                {/* 4. Changed */}
                <section className={styles.section} aria-labelledby="heading-changed">
                  <h3 id="heading-changed" className={styles.sectionTitle}>
                    Changed
                  </h3>
                  {report.changed.length === 0 ? (
                    <p className={styles.empty}>—</p>
                  ) : (
                    <ul className={styles.changedList}>
                      {report.changed.map((change) => (
                        <li key={change.projectId} className={styles.changedItem}>
                          <h4 className={styles.changedProjectName}>
                            {projectNames.get(change.projectId) ?? change.projectId}
                          </h4>
                          {change.files.length === 0 ? (
                            <p className={styles.empty}>—</p>
                          ) : (
                            <ul className={styles.filesList}>
                              {change.files.map((file) => (
                                <li key={file}>
                                  <code>{file}</code>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {/* 5. Problems & Recovery */}
                <section className={styles.section} aria-labelledby="heading-problems-recovery">
                  <h3 id="heading-problems-recovery" className={styles.sectionTitle}>
                    Problems & Recovery
                  </h3>
                  {!hasProblems ? (
                    <p className={styles.empty}>—</p>
                  ) : (
                    <ul className={styles.problemsList}>
                      {report.problems.blindWindows.length > 0 && (
                        <li className={styles.problemItem} data-problem="blind-window">
                          {/* Spec §Daemon honesty: the report must SAY activity may be missing,
                              not just list the time range. */}
                          <p className={styles.blindNote}>
                            Pockrew was not running during these windows — agent activity in them may be missing.
                          </p>
                        </li>
                      )}
                      {report.problems.blindWindows.map((bw, idx) => (
                        <li key={`bw-${idx}`} className={styles.problemItem} data-problem="blind-window">
                          <div className={styles.problemHeader}>
                            <span className={styles.problemKind}>
                              <HugeiconsIcon icon={Satellite01Icon} size={16} aria-hidden="true" />
                              Blind window: {formatClockTime(bw.from)} – {formatClockTime(bw.to)}
                            </span>
                          </div>
                        </li>
                      ))}
                      {report.problems.failures.map((failure) => {
                        const conf = CONFIDENCE_META[failure.confidence];
                        return (
                          <li key={failure.id} className={styles.problemItem} data-problem="failure">
                            <div className={styles.problemHeader}>
                              <span className={styles.problemKind}>
                                <HugeiconsIcon icon={AlertCircleIcon} size={16} aria-hidden="true" />
                                {RECEIPT_KIND_LABEL[failure.kind]}
                              </span>
                              <span className={styles.confidenceBadge} data-confidence={failure.confidence}>
                                <HugeiconsIcon icon={conf.icon} size={14} aria-hidden="true" /> {conf.label}
                              </span>
                              <span className={styles.timeBadge}>{formatElapsed(failure.occurredAt, now)}</span>
                            </div>
                            <p className={styles.problemTitle}>{failure.title}</p>
                          </li>
                        );
                      })}
                      {report.problems.errors.map((err, idx) => {
                        const actorName = actorNames.get(err.actorId) ?? err.actorId;
                        const projName = projectNames.get(err.projectId) ?? err.projectId;
                        return (
                          <li key={`err-${idx}`} className={styles.problemItem} data-problem="error">
                            <div className={styles.problemHeader}>
                              <span className={styles.problemKind}>
                                <HugeiconsIcon icon={AlertCircleIcon} size={16} aria-hidden="true" />
                                Error · {actorName} ({projName})
                              </span>
                              <span className={styles.timeBadge}>{formatElapsed(err.occurredAt, now)}</span>
                            </div>
                            {err.summary ? <p className={styles.problemTitle}>{err.summary}</p> : null}
                          </li>
                        );
                      })}
                      {report.problems.recoveries.map((rec) => {
                        const conf = CONFIDENCE_META[rec.confidence];
                        return (
                          <li key={rec.id} className={styles.problemItem} data-problem="recovery">
                            <div className={styles.problemHeader}>
                              <span className={styles.problemKind}>
                                <HugeiconsIcon icon={PartyIcon} size={16} aria-hidden="true" />
                                {RECEIPT_KIND_LABEL[rec.kind]}
                              </span>
                              <span className={styles.confidenceBadge} data-confidence={rec.confidence}>
                                <HugeiconsIcon icon={conf.icon} size={14} aria-hidden="true" /> {conf.label}
                              </span>
                              <span className={styles.timeBadge}>{formatElapsed(rec.occurredAt, now)}</span>
                            </div>
                            <p className={styles.problemTitle}>{rec.title}</p>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>

                {/* 6. Next Actions */}
                <section className={styles.section} aria-labelledby="heading-next-actions">
                  <h3 id="heading-next-actions" className={styles.sectionTitle}>
                    Next Actions
                  </h3>
                  {report.nextActions.length === 0 ? (
                    <p className={styles.empty}>—</p>
                  ) : (
                    <ol className={styles.nextActionsList}>
                      {report.nextActions.map((action, idx) => (
                        <li key={idx} className={styles.nextActionItem}>
                          {action}
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
};
