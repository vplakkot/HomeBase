"use client";

import { useEffect, useState } from "react";
import styles from "./greeting.module.css";

// "Morning, Vin" and the date, at the top of Home (docs/design/DESIGN.md
// §4). Both depend on the time where the phone is, which only the phone
// knows: a request for a page doesn't say what time zone it came from.
// So the page arrives with a neutral "Hello" and the phone fills in its
// own time once it's showing. Putting the household's time zone in the
// code instead would publish roughly where they live, in a public
// repository.
export function greetingFor(hour: number): string {
  if (hour < 12) return "Morning";
  if (hour < 18) return "Afternoon";
  return "Evening";
}

// "Sunday, 20 September", as the mockups write it.
export function dateLine(now: Date): string {
  const weekday = now.toLocaleDateString("en-GB", { weekday: "long" });
  const dayAndMonth = now.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  return `${weekday}, ${dayAndMonth}`;
}

export function Greeting({ name }: { name: string | null }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  const word = now ? greetingFor(now.getHours()) : "Hello";
  return (
    <div className={styles.greeting}>
      <h1 className={styles.title}>{name ? `${word}, ${name}` : word}</h1>
      {/* A space until the date is known, so nothing below jumps. */}
      <p className={styles.date}>{now ? dateLine(now) : " "}</p>
    </div>
  );
}
