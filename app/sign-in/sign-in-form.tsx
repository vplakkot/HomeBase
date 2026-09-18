"use client";

import { useActionState } from "react";
import { signIn, type SignInState } from "./actions";

const initialState: SignInState = {};

export function SignInForm() {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  return (
    <form action={formAction}>
      <p>
        <label>
          Email
          <br />
          <input type="email" name="email" autoComplete="email" required />
        </label>
      </p>
      <p>
        <label>
          Password
          <br />
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
          />
        </label>
      </p>
      {state.error ? <p role="alert">{state.error}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
