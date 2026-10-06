"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { IMPORTS_CHANGED } from "../../lib/meal-plans/import-flag";

// REQ-167: redraws the Meal Plan page when the recipe toast hears that an
// import moved on (sending, reading, ready, failed), so a page that was
// drawn while the video was sending, then left while the phone was locked,
// says what the toast says instead of "Sending the video".
export function ImportWatch() {
  const router = useRouter();
  useEffect(() => {
    const redraw = () => router.refresh();
    window.addEventListener(IMPORTS_CHANGED, redraw);
    return () => window.removeEventListener(IMPORTS_CHANGED, redraw);
  }, [router]);
  return null;
}
