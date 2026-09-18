"use client";

import { useActionState } from "react";
import { resetPassword, type ResetPasswordState } from "./actions";

const initialState: ResetPasswordState = {};

export function ResetPasswordForm({ userId, label }: { userId: string; label: string }) {
  const [state, formAction, pending] = useActionState(resetPassword, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="userId" value={userId} />
      <input
        type="text"
        name="temporaryPassword"
        aria-label={label}
        placeholder="New temporary password"
        autoComplete="off"
        minLength={8}
        required
      />{" "}
      <button type="submit" disabled={pending}>
        {pending ? "Resetting…" : "Reset password"}
      </button>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.reset ? (
        <p role="status">
          Temporary password set. They are signed out everywhere and must choose
          a new password at their next sign-in.
        </p>
      ) : null}
    </form>
  );
}
