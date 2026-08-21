import { useEffect, useRef } from "react";

/**
 * Escape closes the top-most overlay only. Overlays register while they are open, so the newest one
 * wins and the ones underneath keep theirs — no overlay manager, just a LIFO of close callbacks.
 */
type Close = () => void;

const stack: Close[] = [];

export const pushOverlay = (close: Close): void => {
  stack.push(close);
};

export const popOverlay = (close: Close): void => {
  const at = stack.lastIndexOf(close);
  if (at !== -1) stack.splice(at, 1);
};

export const isTopmost = (close: Close): boolean => stack.at(-1) === close;

/** Closes this overlay on Escape while `active`, but only when it is the top-most one. */
export const useEscapeClose = (active: boolean, onClose: Close): void => {
  // The callback lives in a ref and the stack holds one stable wrapper per overlay: a re-render
  // (every world snapshot passes fresh props) must never re-order the stack under the user.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const entryRef = useRef<Close>(() => onCloseRef.current());

  useEffect(() => {
    if (!active) return;
    const entry = entryRef.current;
    pushOverlay(entry);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !isTopmost(entry)) return;
      entry();
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      popOverlay(entry);
      document.removeEventListener("keydown", handleKey);
    };
  }, [active]);
};
