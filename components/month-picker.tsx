"use client";

import { usePathname, useRouter } from "next/navigation";
import { ChevronDownIcon } from "./icons";
import styles from "./month-picker.module.css";

// Which month a page shows, where it lets you choose (Balances: headers
// no longer carry a picker, REQ-102).
// The page names the month it shows and the months there are to choose
// from, each as "YYYY-MM-01"; choosing one reloads the same page on it.
export function MonthPicker({ current, options }: { current: string; options: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <span className={styles.wrap}>
      <select
        className={styles.picker}
        aria-label="Month"
        value={current}
        onChange={(event) => router.push(`${pathname}?month=${event.target.value.slice(0, 7)}`)}
        disabled={options.length < 2}
      >
        {options.map((month) => (
          <option key={month} value={month}>
            {label(month)}
          </option>
        ))}
      </select>
      <ChevronDownIcon />
    </span>
  );
}

function label(month: string): string {
  return new Date(`${month}T12:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
