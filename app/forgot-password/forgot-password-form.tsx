"use client";

import { useActionState } from "react";
import { requestPasswordReset, type ForgotPasswordState } from "./actions";

const initialState: ForgotPasswordState = {};

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, initialState);

  if (state.sent) {
    return (
      <p role="status">
        If that address has an account, a link to choose a new password is on its way. It can take a
        minute, and it may land in spam.
      </p>
    );
  }
  return (
    <form action={formAction}>
      <p>
        <label>
          Email
          <br />
          <input type="email" name="email" autoComplete="email" required />
        </label>
      </p>
      {state.error ? <p role="alert">{state.error}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send the link"}
      </button>
    </form>
  );
}
