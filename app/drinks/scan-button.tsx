"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import { buttonClass } from "../../components/button";
import { holdPhoto, type Source } from "./scan/pending";
import styles from "./drinks.module.css";

// REQ-122: Scan opens the phone's camera straight away; Choose a photo
// (#206) opens the photo library. Either way the photo goes on to the
// scan screen; cancelling the picker leaves you where you were.
function PhotoButton({ source, label, className, children }: { source: Source; label: string; className: string; children: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const picked = () => {
    const file = input.current?.files?.[0];
    if (!file) return;
    holdPhoto(file, source);
    input.current!.value = "";
    router.push("/drinks/scan");
  };
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture={source === "camera" ? "environment" : undefined}
        className={styles.hiddenLabel}
        aria-label={label}
        onChange={picked}
      />
      <button type="button" className={className} onClick={() => input.current?.click()}>
        {children}
      </button>
    </>
  );
}

export function ScanButton({ className = buttonClass }: { className?: string }) {
  return (
    <PhotoButton source="camera" label="Scan with the camera" className={className}>
      Scan
    </PhotoButton>
  );
}

// Quieter than Scan: plain underlined text beside it.
export function ChoosePhotoButton({ className = styles.quietAction }: { className?: string }) {
  return (
    <PhotoButton source="library" label="Choose a photo from the library" className={className}>
      Choose a photo
    </PhotoButton>
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
