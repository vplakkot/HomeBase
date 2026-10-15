"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { BottomSheet } from "../../components/bottom-sheet";
import { buttonClass } from "../../components/button";

// A button that opens its form in a sheet over the screen. The form
// inside tells the sheet it has saved (useCloseSheet), and the sheet
// closes, leaving you where you were. The sheet's content is only drawn
// while it's open, so every opening starts from a fresh form.
const CloseSheet = createContext<() => void>(() => {});

export const useCloseSheet = () => useContext(CloseSheet);

export function SheetButton({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button type="button" className={buttonClass} onClick={() => setOpen(true)}>
        {label}
      </button>
      <BottomSheet open={open} onClose={close} title={title}>
        {open ? <CloseSheet.Provider value={close}>{children}</CloseSheet.Provider> : null}
      </BottomSheet>
    </>
  );
}
