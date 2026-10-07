"use client";

import { useActionState } from "react";
import { sendTestToMember, type SendTestState } from "./actions";
import styles from "./page.module.css";

const initialState: SendTestState = {};

function describe({ devices, delivered }: { devices: number; delivered: number }) {
  if (devices === 0) return "No device has signed up yet.";
  return `Sent to ${delivered} of ${devices} devices; the rest didn't go through.`;
}

// REQ-159: one person's test. Their switch decides whether anything can go;
// when it's off the button is disabled and the reason sits in its title.
// A fully delivered test shows a small green check in a slot that is always
// there, so the button never moves; only a problem gets words.
export function SendTestPersonForm({ userId, enabled, name }: { userId: string; enabled: boolean; name: string }) {
  const [state, formAction, pending] = useActionState(sendTestToMember, initialState);
  const allDelivered = !!state.sent && state.sent.devices > 0 && state.sent.delivered === state.sent.devices;
  return (
    <form action={formAction} className={styles.testForm}>
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
      <span className={styles.sentMark} role="status" aria-label={allDelivered ? "Sent" : undefined}>
        {allDelivered && !pending ? (
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </span>
      {!enabled ? <span className={styles.rowNote}>Switched off</span> : null}
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.sent && !allDelivered ? <p role="status">{describe(state.sent)}</p> : null}
    </form>
  );
}
