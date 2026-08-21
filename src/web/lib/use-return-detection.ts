import { useEffect, useRef } from "react";

/** 10 minutes in milliseconds (docs/spec.md "Shift Report"). */
export const RETURN_THRESHOLD_MS = 10 * 60_000;

/** Pure decision function for returning user: tab was hidden for at least thresholdMs. */
export const shouldOpenOnReturn = (
  hiddenAt: number | null,
  now: number,
  thresholdMs = RETURN_THRESHOLD_MS,
): boolean => {
  if (hiddenAt === null) return false;
  return now - hiddenAt >= thresholdMs;
};

/**
 * Tracks tab visibility; when the document becomes visible after being hidden
 * for >= 10 minutes, triggers onReturn to auto-open the shift report.
 */
export const useReturnDetection = (onReturn: () => void): void => {
  const onReturnRef = useRef(onReturn);
  onReturnRef.current = onReturn;
  const hiddenAtRef = useRef<number | null>(null);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
      } else if (document.visibilityState === "visible") {
        const hiddenAt = hiddenAtRef.current;
        hiddenAtRef.current = null;
        if (shouldOpenOnReturn(hiddenAt, Date.now())) {
          onReturnRef.current();
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);
};
