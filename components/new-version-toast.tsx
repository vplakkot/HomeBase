"use client";

import { useEffect, useState } from "react";
import { isOutOfDate, refreshApp } from "../lib/app-refresh";
import styles from "./new-version-toast.module.css";

// REQ-128: when a newer build is out than the one this page was loaded
// with, a note at the bottom that stays until Refresh is pressed. It never
// refreshes by itself: a half-filled form must not be lost. It checks when
// the app comes back to the front, and every few minutes while it's open.
export const CHECK_MS = 5 * 60 * 1000;

export function NewVersionToast({ loaded }: { loaded: string }) {
  const [stale, setStale] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const reply = await fetch("/api/version", { cache: "no-store" });
        const { build } = (await reply.json()) as { build?: unknown };
        if (!stopped && isOutOfDate(loaded, build)) setStale(true);
      } catch {
        // Offline, or signed out and answered with the sign-in page.
      }
    };
    void check();
    const timer = setInterval(check, CHECK_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [loaded]);

  if (!stale) return null;
  return (
    <div className={styles.toast} role="status">
      <span>New version ready</span>
      <button
        type="button"
        className={styles.action}
        disabled={refreshing}
        onClick={() => {
          setRefreshing(true);
          void refreshApp();
        }}
      >
        {refreshing ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}
