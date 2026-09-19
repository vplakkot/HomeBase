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
  // Once this form has written something, its own answer wins over the prop.
  // The prop does refresh on its own, because the action revalidates /admin,
  // so this deliberately ignores a change another admin made in between; that
  // tab keeps showing its own write until a full page load. Two admins editing
  // the same member within seconds is the only way to see it, and the write
  // itself is still safe, because the form sends the state it wants rather
  // than "flip this".
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
