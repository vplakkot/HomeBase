"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { sendTestNotification } from "../../lib/notifications/send";
import { hasPermission } from "../../lib/auth/permissions";
import { createAdminClient } from "../../lib/supabase/admin";
import { createClient } from "../../lib/supabase/server";

export type CreateMemberState = { error?: string; created?: string };
export type ChangeRoleState = { error?: string; saved?: boolean };
export type ResetPasswordState = { error?: string; reset?: boolean };
export type NotificationsState = { error?: string; enabled?: boolean };
export type SendTestState = {
  error?: string;
  sent?: { people: number; devices: number; delivered: number };
};

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

export async function setNotifications(
  _previous: NotificationsState,
  formData: FormData,
): Promise<NotificationsState> {
  const userId = String(formData.get("userId") ?? "");
  if (!userId) {
    return { error: "Which member?" };
  }
  // The form sends the state being asked for, not a toggle, so a stale page
  // can't flip someone the wrong way by being submitted twice.
  const enabled = formData.get("enabled") === "true";

  const supabase = await requireManageMembers();
  const { error } = await supabase
    .from("household_members")
    .update({ notifications_enabled: enabled })
    .eq("user_id", userId);
  if (error) {
    return { error: error.message };
  }

  // No error does not by itself mean a row changed: row-level security
  // filters an update to zero rows without complaining. Reading the row back
  // to confirm isn't open to us, because this runs as the signed-in admin and
  // the column is closed to them.
  //
  // What rules out the row-level-security case is not similarity but
  // identity: requireManageMembers() calls public.has_permission
  // ('manage_members'), which is the same function the policy's own check
  // calls, as the same database role in the same request. One predicate
  // evaluated twice, so the two cannot drift apart.
  //
  // The case it does not cover is a user_id that no longer exists — a stale
  // roster, or simply a value posted to this action directly. Then nothing
  // matches, nothing errors, and this reports success for somebody who isn't
  // there. Nothing is corrupted, and the next render drops them from the
  // roster, so it corrects itself.
  revalidatePath("/admin");
  return { enabled };
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

// "Send test now": a test notification, started by an admin. The hourly
// one it once matched was stopped on 2026-09-24. Only a manage_members holder gets this far, and the
// recipients are the same either way — everyone whose switch is on.
export async function sendTestNow(
  _previous: SendTestState,
  _formData: FormData,
): Promise<SendTestState> {
  await requireManageMembers();

  const host = (await headers()).get("host");
  if (!host) {
    return { error: "Couldn't work out this app's own address." };
  }

  try {
    const summary = await sendTestNotification({
      subject: `https://${host}`,
      trigger: "manual",
    });
    return {
      sent: {
        people: summary.people,
        devices: summary.devices,
        delivered: summary.delivered,
      },
    };
  } catch (reason) {
    console.error("Could not send a test notification", reason);
    return { error: "Couldn't send the test notification. Try again." };
  }
}
