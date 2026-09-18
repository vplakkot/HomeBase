"use client";

import { useActionState } from "react";
import { signUp, type SignUpState } from "./actions";

const initialState: SignUpState = {};

export function SignUpForm() {
  const [state, formAction, pending] = useActionState(signUp, initialState);

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
            autoComplete="new-password"
            required
          />
        </label>
      </p>
      {state.error ? <p role="alert">{state.error}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create household"}
      </button>
    </form>
  );
}
