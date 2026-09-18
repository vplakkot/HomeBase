"use client";

import { useActionState } from "react";
import { setPassword, type SetPasswordState } from "./actions";

const initialState: SetPasswordState = {};

export function SetPasswordForm() {
  const [state, formAction, pending] = useActionState(setPassword, initialState);

  return (
    <form action={formAction}>
      <p>
        <label>
          New password
          <br />
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
      </p>
      <p>
        <label>
          New password again
          <br />
          <input
            type="password"
            name="confirmation"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
      </p>
      {state.error ? <p role="alert">{state.error}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
