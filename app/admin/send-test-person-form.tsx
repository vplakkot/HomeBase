"use client";

import { useActionState } from "react";
import { sendTestToMember, type SendTestState } from "./actions";
import styles from "./page.module.css";

const initialState: SendTestState = {};

function describe({ devices, delivered }: { devices: number; delivered: number }) {
  if (devices === 0) return "No device has signed up yet.";
  if (delivered === devices) return `Sent to ${devices} ${devices === 1 ? "device" : "devices"}.`;
  return `Sent to ${delivered} of ${devices} devices; the rest didn't go through.`;
}

// REQ-159: one person's test. Their switch decides whether anything can go;
// when it's off the button is disabled and the reason sits in its title.
export function SendTestPersonForm({ userId, enabled, name }: { userId: string; enabled: boolean; name: string }) {
  const [state, formAction, pending] = useActionState(sendTestToMember, initialState);
  return (
    <form action={formAction}>
      <input type="hidden" name="userId" value={userId} />
      <button
        type="submit"
        className={styles.button}
        disabled={pending || !enabled}
        title={enabled ? undefined : `Notifications are switched off for ${name}`}
        aria-label={`Send test to ${name}`}
      >
        {pending ? "Sending…" : "Send test"}
      </button>
      {!enabled ? <span className={styles.rowNote}>Switched off</span> : null}
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.sent ? <p role="status">{describe(state.sent)}</p> : null}
    </form>
  );
}
