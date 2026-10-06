"use client";

import { useActionState } from "react";
import { setGoogleEmail, type GoogleEmailState } from "./actions";

const initialState: GoogleEmailState = {};

// REQ-152: a member's Google account email, optional.
export function GoogleEmailForm({ userId, current, label }: { userId: string; current: string | null; label: string }) {
  const [state, formAction, pending] = useActionState(setGoogleEmail, initialState);
  return (
    <form action={formAction}>
      <input type="hidden" name="userId" value={userId} />
      <input
        type="email"
        name="googleEmail"
        defaultValue={current ?? ""}
        placeholder="Google account email (optional)"
        aria-label={label}
      />{" "}
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save Google email"}
      </button>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.saved ? <p role="status">Saved.</p> : null}
    </form>
  );
}
