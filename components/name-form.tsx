"use client";

import { useActionState } from "react";
import { NAME_MAX } from "../lib/auth/names";
import type { NameState } from "../app/profile/actions";
import styles from "./name-form.module.css";

// REQ-124: one name, typed and saved. Profile uses it for your own name;
// the admin console's People card for any member's, with their id.
export function NameForm({
  action,
  name,
  label,
  userId,
}: {
  action: (previous: NameState, formData: FormData) => Promise<NameState>;
  name: string | null;
  label: string;
  userId?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className={styles.form}>
      {userId ? <input type="hidden" name="userId" value={userId} /> : null}
      <input
        name="name"
        defaultValue={name ?? ""}
        aria-label={label}
        placeholder="Name"
        maxLength={NAME_MAX}
        required
        autoComplete="name"
      />{" "}
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save name"}
      </button>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.saved ? <p role="status">Name saved.</p> : null}
    </form>
  );
}
