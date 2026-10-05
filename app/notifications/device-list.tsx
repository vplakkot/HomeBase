"use client";

import { useEffect, useState } from "react";
import { LocalTime } from "../admin/local-time";
import type { DeviceView } from "../../lib/notifications/devices";
import { stopReceivingHere } from "../../lib/notifications/this-device";
import styles from "./device-list.module.css";

type Result = { error?: string; done?: string };

// REQ-160: the devices that get a person's notifications, each with a
// button to remove it and, where offered, one to send it a test. Settings
// loads your own when it opens; the admin console is handed each member's.
export function DeviceList({
  initial,
  load,
  remove,
  test,
  who = "your",
}: {
  initial?: DeviceView[];
  load?: () => Promise<DeviceView[]>;
  remove: (deviceId: string) => Promise<Result>;
  test?: (deviceId: string) => Promise<Result>;
  who?: string;
}) {
  const [devices, setDevices] = useState<DeviceView[] | null>(initial ?? null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!load) return;
    let current = true;
    load().then(
      (found) => current && setDevices(found),
      () => current && setDevices([]),
    );
    return () => {
      current = false;
    };
  }, [load]);

  // The admin console draws again after a removal; take what it hands over.
  useEffect(() => {
    if (initial) setDevices(initial);
  }, [initial]);

  if (devices === null) return <p className={styles.empty}>Checking devices…</p>;
  if (devices.length === 0) return <p className={styles.empty}>No devices yet.</p>;

  const say = (id: string, text: string) => setMessages((now) => ({ ...now, [id]: text }));

  async function onRemove(device: DeviceView) {
    setBusy(device.id);
    const result = await remove(device.id);
    setBusy(null);
    if (result.error) return say(device.id, result.error);
    // The push service forgets this phone too, so nothing can reach it.
    if (device.thisDevice) await stopReceivingHere();
    setDevices((now) => (now ?? []).filter((each) => each.id !== device.id));
  }

  async function onTest(device: DeviceView) {
    if (!test) return;
    setBusy(device.id);
    say(device.id, "");
    const result = await test(device.id);
    setBusy(null);
    say(device.id, result.error ?? result.done ?? "");
  }

  return (
    <ul className={styles.list} aria-label={`Devices for ${who}`}>
      {devices.map((device) => (
        <li key={device.id} className={styles.device}>
          <span className={styles.what}>
            <span className={styles.name}>
              {device.name}
              {device.thisDevice ? <span className={styles.this}> This device</span> : null}
            </span>
            <span className={styles.detail}>
              Added <LocalTime value={device.addedAt} /> ·{" "}
              {device.lastReceivedAt ? (
                <>
                  Last notification <LocalTime value={device.lastReceivedAt} />
                </>
              ) : (
                "No notification yet"
              )}
            </span>
          </span>
          {test ? (
            <button type="button" className={styles.button} disabled={busy === device.id} onClick={() => onTest(device)}>
              Send test
            </button>
          ) : null}
          <button type="button" className={styles.button} disabled={busy === device.id} onClick={() => onRemove(device)}>
            Remove
          </button>
          {messages[device.id] ? (
            <p role="status" className={styles.status}>
              {messages[device.id]}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
