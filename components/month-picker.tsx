"use client";

import { useEffect, useState } from "react";
import { ChevronDownIcon } from "./icons";
import styles from "./month-picker.module.css";

// The month a module is showing, in its header (docs/design/DESIGN.md §7).
// Like the greeting, it needs the phone's own clock, so the page arrives
// saying "This month" and the phone fills in which. Choosing another month
// comes with the months themselves in v1.0, so for now it can't be pressed.
export function MonthPicker() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  const month = now
    ? now.toLocaleDateString("en-GB", { month: "long", year: "numeric" })
    : "This month";
  return (
    <button type="button" className={styles.picker} disabled>
      {month}
      <ChevronDownIcon />
    </button>
  );
}
