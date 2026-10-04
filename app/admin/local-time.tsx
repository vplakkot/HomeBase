"use client";

import { useEffect, useState } from "react";

// The log's times in the viewer's own time zone (#93). The server can't
// know that zone, and drawing one format on the server and another in the
// browser would make React complain, so the first draw is the fixed UTC
// text the server drew, and it becomes local time once the page is in the
// browser. The exact instant is kept in the element for anyone who wants it.
function utc(value: string): string {
  return `${new Date(value).toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

export function LocalTime({ value }: { value: string }) {
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => {
    setLocal(
      new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
    );
  }, [value]);
  return <time dateTime={value}>{local ?? utc(value)}</time>;
}
