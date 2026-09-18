"use client";

import { useActionState } from "react";
import type { Role } from "../../lib/auth/members";
import { changeRole, type ChangeRoleState } from "./actions";

const initialState: ChangeRoleState = {};

export function RoleForm({
  userId,
  roleId,
  roles,
  label,
}: {
  userId: string;
  roleId: string;
  roles: Role[];
  label: string;
}) {
  const [state, formAction, pending] = useActionState(changeRole, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="userId" value={userId} />
      <select name="roleId" defaultValue={roleId} aria-label={label}>
        {roles.map((role) => (
          <option key={role.id} value={role.id}>
            {role.name}
          </option>
        ))}
      </select>{" "}
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save role"}
      </button>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.saved ? <p role="status">Role saved. It applies on their next page load.</p> : null}
    </form>
  );
}
