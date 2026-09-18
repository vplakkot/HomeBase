"use client";

import { useActionState } from "react";
import { createMember, type CreateMemberState } from "./actions";

const initialState: CreateMemberState = {};

export function CreateMemberForm() {
  const [state, formAction, pending] = useActionState(createMember, initialState);

  return (
    <form action={formAction}>
      <p>
        <label>
          Name
          <br />
          <input type="text" name="name" autoComplete="off" required />
        </label>
      </p>
      <p>
        <label>
          Email
          <br />
          <input type="email" name="email" autoComplete="off" required />
        </label>
      </p>
      <p>
        <label>
          Temporary password
          <br />
          <input
            type="text"
            name="temporaryPassword"
            autoComplete="off"
            minLength={8}
            required
          />
        </label>
      </p>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.created ? (
        <p role="status">
          Account created for {state.created}. No email was sent — tell them
          the temporary password yourself. They will be asked to choose their
          own on first sign-in.
        </p>
      ) : null}
      <button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create member"}
      </button>
    </form>
  );
}
