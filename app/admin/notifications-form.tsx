"use client";

import { useActionState } from "react";
import { setNotifications, type NotificationsState } from "./actions";

const initialState: NotificationsState = {};

export function NotificationsForm({
  userId,
  enabled,
  label,
}: {
  userId: string;
  enabled: boolean;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(setNotifications, initialState);
  // Until the page reloads, the action's answer is the truth; before that,
  // what the roster was rendered with.
  const on = state.enabled ?? enabled;

  return (
    <form action={formAction}>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="enabled" value={on ? "false" : "true"} />
      <button type="submit" disabled={pending} aria-label={label}>
        {pending ? "Saving…" : on ? "On — turn off" : "Off — turn on"}
      </button>
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
