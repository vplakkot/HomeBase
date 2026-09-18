"use server";

import { redirect } from "next/navigation";
import { hasPermission } from "../../lib/auth/permissions";
import { createAdminClient } from "../../lib/supabase/admin";
import { createClient } from "../../lib/supabase/server";

export type CreateMemberState = { error?: string; created?: string };

export async function createMember(
  _previous: CreateMemberState,
  formData: FormData,
): Promise<CreateMemberState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
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

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: { name },
    app_metadata: { created_by_admin: true, must_set_password: true },
  });
  if (error) {
    return { error: error.message };
  }

  return { created: email };
}
