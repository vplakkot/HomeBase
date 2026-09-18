"use server";

import { redirect } from "next/navigation";
import { hasPermission } from "../../lib/auth/permissions";
import { createAdminClient } from "../../lib/supabase/admin";
import { createClient } from "../../lib/supabase/server";

export type CreateMemberState = { error?: string; created?: string };

const UNIQUE_VIOLATION = "23505";

export async function createMember(
  _previous: CreateMemberState,
  formData: FormData,
): Promise<CreateMemberState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const temporaryPassword = String(formData.get("temporaryPassword") ?? "");
  if (!name || !email || !temporaryPassword) {
    return { error: "Name, email and a temporary password are all required." };
  }
  if (temporaryPassword.length < 8) {
    return { error: "Use at least 8 characters for the temporary password." };
  }

  const supabase = await createClient();
  if (!(await hasPermission(supabase, "manage_members"))) {
    redirect("/");
  }

  // The invitation must exist before the account does: it is what the
  // database trigger checks when the new user row arrives.
  const { error: inviteError } = await supabase
    .from("member_invitations")
    .insert({ email });
  if (inviteError) {
    return {
      error:
        inviteError.code === UNIQUE_VIOLATION
          ? "An invitation for that email is already waiting to be used."
          : inviteError.message,
    };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: { name },
    app_metadata: { must_set_password: true },
  });
  if (error) {
    await supabase.from("member_invitations").delete().eq("email", email);
    return { error: error.message };
  }

  return { created: email };
}
