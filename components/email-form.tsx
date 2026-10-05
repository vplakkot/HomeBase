"use client";

import { useActionState } from "react";
import type { EmailChangeState } from "../lib/auth/email";
import styles from "./name-form.module.css";

// REQ-158: a new email address, typed and sent. Profile uses it for your
// own; the admin console's People card for any member's, with their id.
// Nothing changes on screen until the new address confirms it, so the
// answer says what was sent and where.
export function EmailForm({
  action,
  label,
  userId,
}: {
  action: (previous: EmailChangeState, formData: FormData) => Promise<EmailChangeState>;
  label: string;
  userId?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className={styles.form}>
      {userId ? <input type="hidden" name="userId" value={userId} /> : null}
      <input type="email" name="email" aria-label={label} placeholder="New email" required autoComplete="off" />{" "}
      <button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Change email"}
      </button>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.sent?.kind === "confirm" ? (
        <p role="status">
          A confirmation was sent to {state.sent.address}. The email changes once it&apos;s confirmed there.
        </p>
      ) : null}
      {state.sent?.kind === "invite" ? (
        <p role="status">
          Changed. A link to choose a password was sent to {state.sent.address}.
        </p>
      ) : null}
    </form>
  );
}
