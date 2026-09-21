"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./bottom-sheet.module.css";

// A panel that slides up over the bottom of a phone screen, or sits in
// the middle of a desktop one, for things that shouldn't take you off
// the page (docs/design/DESIGN.md §4 and §6). It's the browser's own
// <dialog>: opening it moves keyboard focus inside, and closing hands
// focus back to whatever opened it (both seen in a browser). By the HTML
// standard it also closes on Escape, which couldn't be checked here.
// Tapping the dimmed page around it, or Close, closes it too.
export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onClose={onClose}>
      {/* A pointer convenience; keyboards have Escape and the Close button. */}
      <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
      <div className={styles.panel}>
        <span className={styles.grabber} aria-hidden="true" />
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <button type="button" className={styles.close} onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
