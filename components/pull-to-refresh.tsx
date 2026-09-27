"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { refreshApp } from "../lib/app-refresh";
import styles from "./pull-to-refresh.module.css";

// REQ-127: pull down at the top of a screen and let go to refresh. Only in
// the installed app: a phone's browser and a desktop have their own
// reload. A pull only counts from the very top (scrolled down, it's just
// scrolling), and never while a sheet or dialog is open or something has
// been typed or read into a form on this screen, since a reload would
// lose it.

// How far, in pixels, a pull must go before letting go refreshes.
export const PULL_TO_REFRESH = 70;
// The spinner follows the finger at this fraction of its travel.
const DRAG = 0.5;

export function isInstalledApp(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

// Whether a pull starting on this element may refresh.
export function canPullFrom(target: EventTarget | null, edited: boolean): boolean {
  if (edited || window.scrollY > 0) return false;
  if (document.querySelector("dialog[open], [aria-modal='true'], [data-unsaved]")) return false;
  for (let element = target instanceof Element ? target : null; element; element = element.parentElement) {
    if (element.scrollTop > 0) return false;
  }
  return true;
}

export function PullToRefresh() {
  const pathname = usePathname();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const edited = useRef(false);

  // A new screen starts with nothing typed into it.
  useEffect(() => {
    edited.current = false;
  }, [pathname]);

  useEffect(() => {
    if (!isInstalledApp()) return;
    let start: number | null = null;
    let distance = 0;
    const onInput = () => {
      edited.current = true;
    };
    const onStart = (event: TouchEvent) => {
      start = event.touches.length === 1 && canPullFrom(event.target, edited.current) ? event.touches[0].clientY : null;
      distance = 0;
    };
    const onMove = (event: TouchEvent) => {
      if (start === null) return;
      distance = Math.max(0, event.touches[0].clientY - start);
      setPull(Math.min(distance * DRAG, PULL_TO_REFRESH));
    };
    const onEnd = () => {
      if (start === null) return;
      start = null;
      if (distance * DRAG >= PULL_TO_REFRESH) {
        setRefreshing(true);
        void refreshApp();
      } else {
        setPull(0);
      }
    };
    document.addEventListener("input", onInput, true);
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    return () => {
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  if (pull === 0 && !refreshing) return null;
  return (
    <div
      className={styles.holder}
      style={{ transform: `translateY(${refreshing ? PULL_TO_REFRESH : pull}px)` }}
      role="status"
      aria-label={refreshing ? "Refreshing" : "Pull to refresh"}
    >
      <span
        className={`${styles.spinner} ${refreshing ? styles.turning : ""}`}
        style={{ opacity: refreshing ? 1 : pull / PULL_TO_REFRESH }}
      />
    </div>
  );
}
