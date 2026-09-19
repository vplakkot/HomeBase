"use client";

import { useEffect, useState } from "react";
import { saveDevice } from "./actions";

type Status =
  | "checking"
  | "needs-install"
  | "unsupported"
  | "not-set-up"
  | "ready"
  | "asking"
  | "on"
  | "off"
  | "failed";

// iPhones only offer notifications to a web app opened from the home
// screen, never to a Safari tab.
function isInstalled(): boolean {
  const displayMode =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  const iosHomeScreen =
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return displayMode || iosHomeScreen;
}

function canReceivePush(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// The public key is stored as text (base64url); the browser wants bytes.
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function currentStatus(publicKey?: string): Promise<Status> {
  if (!isInstalled()) return "needs-install";
  if (!canReceivePush()) return "unsupported";
  if (!publicKey) return "not-set-up";
  await navigator.serviceWorker.register("/sw.js");
  if (Notification.permission === "denied") return "off";
  if (Notification.permission === "granted") {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    // Saving again is harmless and repairs a device the database lost.
    if (existing && (await saveDevice(existing.toJSON())).saved) return "on";
  }
  return "ready";
}

export function EnableNotifications({ publicKey }: { publicKey?: string }) {
  const [status, setStatus] = useState<Status>("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    currentStatus(publicKey).then(
      (next) => current && setStatus(next),
      (reason: unknown) => {
        if (!current) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setStatus("failed");
      },
    );
    return () => {
      current = false;
    };
  }, [publicKey]);

  async function enable() {
    setStatus("asking");
    setError(null);
    try {
      // This must be the first thing after the tap: an iPhone only shows
      // the permission question when it comes straight from a tap.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("off");
        return;
      }
      // Registering again is harmless, and it's what rescues "Try again"
      // when registering failed as the page opened: until something
      // registers, `ready` would wait forever.
      await navigator.serviceWorker.register("/sw.js");
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey ?? ""),
        }));
      const result = await saveDevice(subscription.toJSON());
      if (result.saved) {
        setStatus("on");
      } else {
        setError(result.error);
        setStatus("failed");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus("failed");
    }
  }

  return (
    <section aria-labelledby="notifications-heading">
      <h2 id="notifications-heading">Notifications</h2>
      {status === "checking" ? <p>Checking this device…</p> : null}
      {status === "needs-install" ? (
        <p>
          Notifications need HomeBase on your home screen. In Safari, tap
          Share, then Add to Home Screen, and open HomeBase from there.
        </p>
      ) : null}
      {status === "unsupported" ? (
        <p>
          This device can&apos;t get notifications from HomeBase. On an
          iPhone that needs iOS 16.4 or later.
        </p>
      ) : null}
      {status === "not-set-up" ? (
        <p>Notifications aren&apos;t set up on this server yet.</p>
      ) : null}
      {status === "ready" || status === "asking" ? (
        <button type="button" onClick={enable} disabled={status === "asking"}>
          {status === "asking" ? "Asking…" : "Enable notifications"}
        </button>
      ) : null}
      {status === "on" ? <p>Notifications are on for this device.</p> : null}
      {status === "off" ? (
        <p>
          Notifications are off for this device. To turn them on, open the
          Settings app, tap Notifications, then HomeBase, and switch on Allow
          Notifications.
        </p>
      ) : null}
      {status === "failed" ? (
        <>
          <p role="alert">Couldn&apos;t turn notifications on. {error}</p>
          <button type="button" onClick={enable}>
            Try again
          </button>
        </>
      ) : null}
    </section>
  );
}
