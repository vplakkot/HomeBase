"use client";

import { useActionState } from "react";
import { sendTestNow, type SendTestState } from "./actions";

const initialState: SendTestState = {};

function describe({
  people,
  devices,
  delivered,
}: {
  people: number;
  devices: number;
  delivered: number;
}) {
  if (people === 0) {
    return "Nobody has notifications turned on, so nothing was sent.";
  }
  if (devices === 0) {
    return `Notifications are on for ${people === 1 ? "one person" : `${people} people`}, but no device has signed up yet.`;
  }
  if (delivered === devices) {
    return `Sent to ${devices} ${devices === 1 ? "device" : "devices"}.`;
  }
  return `Sent to ${delivered} of ${devices} devices; the rest didn't go through.`;
}

export function SendTestForm() {
  const [state, formAction, pending] = useActionState(sendTestNow, initialState);

  return (
    <form action={formAction}>
      <button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send test now"}
      </button>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.sent ? <p role="status">{describe(state.sent)}</p> : null}
    </form>
  );
}
