"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import { buttonClass } from "../../components/button";
import { holdPhoto } from "./scan/pending";
import styles from "./drinks.module.css";

// REQ-122: Scan opens the phone's camera straight away. The photo goes
// on to the scan screen; cancelling the camera leaves you where you were.
export function ScanButton({ className = buttonClass }: { className?: string }) {
  const router = useRouter();
  const camera = useRef<HTMLInputElement>(null);
  const picked = () => {
    const file = camera.current?.files?.[0];
    if (!file) return;
    holdPhoto(file, "camera");
    camera.current!.value = "";
    router.push("/drinks/scan");
  };
  return (
    <>
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        className={styles.hiddenLabel}
        aria-label="Scan with the camera"
        onChange={picked}
      />
      <button type="button" className={className} onClick={() => camera.current?.click()}>
        Scan
      </button>
    </>
  );
}

// REQ-122: the scan screen's way back to wherever Scan was tapped; a scan
// opened from a link goes to the Overview.
export function CancelScan() {
  const router = useRouter();
  return (
    <button
      type="button"
      className={buttonClass}
      onClick={() => (window.history.length > 1 ? router.back() : router.push("/drinks"))}
    >
      Cancel
    </button>
  );
}
