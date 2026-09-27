// REQ-127 and REQ-128: loading the newest release on an installed phone.
//
// An installed app is one long-lived page: moving between screens swaps
// content inside it, so the code it started with keeps running until the
// page itself reloads. The service worker keeps no copies of pages
// (public/sw.js has no cache), so a reload always fetches them fresh.
// Before reloading, the phone is asked to check for a newer service
// worker too, and given a moment to switch to it, so the refresh doesn't
// leave the new one waiting for the next launch.

// How long a new service worker gets to take over before the reload goes
// ahead anyway: a refresh must never hang.
const SWITCH_MS = 3000;

function settled(worker: ServiceWorker, within: number): Promise<void> {
  return new Promise((resolve) => {
    if (worker.state === "activated" || worker.state === "redundant") return resolve();
    const timer = setTimeout(resolve, within);
    worker.addEventListener("statechange", () => {
      if (worker.state === "activated" || worker.state === "redundant") {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

export async function refreshApp(reload: () => void = () => window.location.reload()): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.update();
      const incoming = registration.installing ?? registration.waiting;
      if (incoming) await settled(incoming, SWITCH_MS);
    }
  } catch {
    // Offline, or no service worker here: a plain reload is still right.
  }
  reload();
}

// REQ-128: which build this page was loaded with, next to which one the
// server runs now. Anything unreadable (signed out, offline) counts as no
// news, so the toast only ever shows for a real difference.
export function isOutOfDate(loaded: string, current: unknown): boolean {
  return typeof current === "string" && current !== "" && current !== loaded;
}
