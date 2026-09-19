"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission } from "../../lib/auth/permissions";
import { createAdminClient } from "../../lib/supabase/admin";
import { createClient } from "../../lib/supabase/server";

export type CreateMemberState = { error?: string; created?: string };
export type ChangeRoleState = { error?: string; saved?: boolean };
export type ResetPasswordState = { error?: string; reset?: boolean };

const UNIQUE_VIOLATION = "23505";

async function requireManageMembers() {
  const supabase = await createClient();
  if (!(await hasPermission(supabase, "manage_members"))) {
    redirect("/");
  }
  return supabase;
}

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

  const supabase = await requireManageMembers();

  // An invitation left behind by a create that died mid-way expires by
  // itself, but clearing spent ones here means a retry doesn't have to wait
  // out the clock.
  await supabase
    .from("member_invitations")
    .delete()
    .lt("expires_at", new Date().toISOString());

  // The invitation must exist before the account does: it is what the
  // database trigger checks when the new user row arrives.
  const { error: inviteError } = await supabase
    .from("member_invitations")
    .insert({ email });
  if (inviteError) {
    return {
      error:
        inviteError.code === UNIQUE_VIOLATION
          ? "An invitation for that email is already waiting to be used. If an earlier attempt failed, it clears itself within ten minutes."
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

  revalidatePath("/admin");
  return { created: email };
}

export async function changeRole(
  _previous: ChangeRoleState,
  formData: FormData,
): Promise<ChangeRoleState> {
  const userId = String(formData.get("userId") ?? "");
  const roleId = String(formData.get("roleId") ?? "");
  if (!userId || !roleId) {
    return { error: "Pick a role." };
  }

  const supabase = await requireManageMembers();
  const { error } = await supabase
    .from("household_members")
    .update({ role_id: roleId })
    .eq("user_id", userId);
  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin");
  return { saved: true };
}

export async function resetPassword(
  _previous: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const userId = String(formData.get("userId") ?? "");
  const temporaryPassword = String(formData.get("temporaryPassword") ?? "");
  if (!userId) {
    return { error: "Which member?" };
  }
  if (temporaryPassword.length < 8) {
    return { error: "Use at least 8 characters for the temporary password." };
  }

  await requireManageMembers();

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    password: temporaryPassword,
    app_metadata: { must_set_password: true },
  });
  if (error) {
    return { error: error.message };
  }

  return { reset: true };
}
