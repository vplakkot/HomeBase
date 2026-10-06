"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { removeDevice } from "../../lib/notifications/devices";
import { MESSAGES, sendPush, sendTestNotification } from "../../lib/notifications/send";
import { randomBytes } from "node:crypto";
import {
  cleanEmail,
  confirmUrl,
  EMAIL_INVALID_MESSAGE,
  EMAIL_TAKEN_MESSAGE,
  emailErrorMessage,
  usedByAnother,
  type EmailChangeState,
} from "../../lib/auth/email";
import { listMembers } from "../../lib/auth/members";
import { cleanName, NAME_MAX } from "../../lib/auth/names";
import { hasPermission } from "../../lib/auth/permissions";
import { SWITCHES } from "../../lib/modules";
import { createAdminClient } from "../../lib/supabase/admin";
import { createEphemeralClient } from "../../lib/supabase/ephemeral";
import { createClient } from "../../lib/supabase/server";

export type CreateMemberState = { error?: string; created?: string };
export type ChangeRoleState = { error?: string; saved?: boolean };
export type RenameState = { error?: string; saved?: boolean };
export type GoogleEmailState = { error?: string; saved?: boolean };
export type ResetPasswordState = { error?: string; reset?: boolean };
export type NotificationsState = { error?: string; enabled?: boolean };
export type ModuleSwitchState = { error?: string; on?: boolean };
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

// REQ-152: the Google account a member's Drive documents belong to, so a
// document Drive says they own is theirs in Paperwork too. Optional: left
// empty, it's cleared. It's only compared with Drive's owners, never used
// to sign in or sent anything.
export async function setGoogleEmail(
  _previous: GoogleEmailState,
  formData: FormData,
): Promise<GoogleEmailState> {
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return { error: "Which member?" };
  const typed = String(formData.get("googleEmail") ?? "").trim();
  const email = typed === "" ? null : cleanEmail(typed);
  if (typed !== "" && !email) return { error: EMAIL_INVALID_MESSAGE };

  const supabase = await requireManageMembers();
  const { error } = await supabase.from("household_members").update({ google_email: email }).eq("user_id", userId);
  if (error) return { error: error.message };

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

// REQ-124: an admin setting any member's name from the People card. Only
// someone in this household can be renamed: the id posted is checked
// against the member list first, since the secret key could rename any
// account. Renaming yourself here refreshes your own token, as Profile
// does, so the new name shows at once.
export async function renameMember(_previous: RenameState, formData: FormData): Promise<RenameState> {
  const userId = String(formData.get("userId") ?? "");
  const name = cleanName(formData.get("name"));
  if (!userId) return { error: "Which member?" };
  if (!name) return { error: `Type a name, up to ${NAME_MAX} characters.` };

  const supabase = await requireManageMembers();
  const { data: member, error: lookup } = await supabase
    .from("household_members")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (lookup) return { error: lookup.message };
  if (!member) return { error: "That person isn't in this household." };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { user_metadata: { name } });
  if (error) return { error: error.message };

  const { data } = await supabase.auth.getClaims();
  if (data?.claims?.sub === userId) await supabase.auth.refreshSession();
  revalidatePath("/", "layout");
  return { saved: true };
}

// REQ-158: the admin changing any member's email. The account is the same
// one afterwards, so their data, role, notification switch and module
// settings stay as they are, and only the new address is ever emailed.
//
// Someone who has signed in before gets a confirmation at the new address,
// and the change takes effect once they follow it: Supabase's own email-
// change step, run as them for this one request (a short sign-in made with
// a one-time link, ended straight after). Someone who never has gets their
// address changed at once, their temporary password thrown away so any
// earlier invite stops working, and a link at the new address to choose a
// password: the first-time sign-in, ending in the forced password change.
export async function changeMemberEmail(
  _previous: EmailChangeState,
  formData: FormData,
): Promise<EmailChangeState> {
  const userId = String(formData.get("userId") ?? "");
  const email = cleanEmail(formData.get("email"));
  if (!userId) return { error: "Which member?" };
  if (!email) return { error: EMAIL_INVALID_MESSAGE };

  const supabase = await requireManageMembers();
  let members;
  try {
    members = await listMembers(supabase);
  } catch (reason) {
    console.error("Could not list the members", reason);
    return { error: "Couldn't check that address. Try again in a moment." };
  }
  const member = members.find((each) => each.user_id === userId);
  if (!member) return { error: "That person isn't in this household." };
  if (member.email.toLowerCase() === email) return { error: "That is already their email." };
  if (usedByAnother(members, email, userId)) return { error: EMAIL_TAKEN_MESSAGE };

  const redirectTo = confirmUrl((await headers()).get("host"));
  const admin = createAdminClient();
  const { data: account, error: lookup } = await admin.auth.admin.getUserById(userId);
  if (lookup || !account.user) return { error: "Couldn't look that account up. Try again." };

  if (!account.user.last_sign_in_at) {
    // Never signed in: move the address, void the old temporary password,
    // and send a link to choose one.
    const { error } = await admin.auth.admin.updateUserById(userId, {
      email,
      email_confirm: true,
      password: randomBytes(24).toString("base64url"),
      app_metadata: { must_set_password: true },
    });
    if (error) {
      console.error("changeMemberEmail failed", error.code, error.message);
      return { error: emailErrorMessage(error) };
    }
    revalidatePath("/admin");
    const { error: sendError } = await createEphemeralClient().auth.resetPasswordForEmail(email, { redirectTo });
    if (sendError) {
      console.error("changeMemberEmail: the link did not send", sendError.code, sendError.message);
      return {
        error: `The address is changed, but the email didn't send (${emailErrorMessage(sendError)}) Use "Reset password" to give them a temporary one, or change the address again to retry.`,
      };
    }
    return { sent: { address: email, kind: "invite" } };
  }

  // Signed in before: a confirmation to the new address.
  const { data: me } = await supabase.auth.getClaims();
  let failure: { code?: string; message: string } | null = null;
  if (me?.claims?.sub === userId) {
    ({ error: failure } = await supabase.auth.updateUser({ email }, { emailRedirectTo: redirectTo }));
  } else {
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: member.email,
    });
    const tokenHash = link?.properties?.hashed_token;
    if (linkError || !tokenHash) {
      console.error("changeMemberEmail: no link", linkError?.message);
      return { error: "Couldn't start the change. Try again." };
    }
    const asThem = createEphemeralClient();
    const { error: verifyError } = await asThem.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
    if (verifyError) {
      console.error("changeMemberEmail: could not act as them", verifyError.message);
      return { error: "Couldn't start the change. Try again." };
    }
    try {
      ({ error: failure } = await asThem.auth.updateUser({ email }, { emailRedirectTo: redirectTo }));
    } catch (reason) {
      console.error("changeMemberEmail: the change threw", reason);
      failure = { message: "threw" };
    } finally {
      // That short sign-in was only for this request.
      await asThem.auth.signOut({ scope: "local" }).catch(() => {});
    }
  }
  if (failure) {
    console.error("changeMemberEmail failed", failure.code, failure.message);
    return { error: emailErrorMessage(failure) };
  }
  return { sent: { address: email, kind: "confirm" } };
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

// REQ-159: a test to one member's devices only, for checking a single
// person's setup without notifying everyone. Their switch decides, as for
// every notification: switched off, nothing goes.
export async function sendTestToMember(
  _previous: SendTestState,
  formData: FormData,
): Promise<SendTestState> {
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return { error: "Which member?" };
  await requireManageMembers();

  const host = (await headers()).get("host");
  if (!host) {
    return { error: "Couldn't work out this app's own address." };
  }
  try {
    const summary = await sendPush({
      subject: `https://${host}`,
      trigger: "manual",
      to: [userId],
      message: { ...MESSAGES.manual, url: "/" },
    });
    return {
      sent: { people: summary.people, devices: summary.devices, delivered: summary.delivered },
    };
  } catch (reason) {
    console.error("Could not send a test notification", reason);
    return { error: "Couldn't send the test notification. Try again." };
  }
}

// REQ-160: the admin removing any member's device. Only a manage_members
// holder gets this far; the table itself only holds members' devices.
export async function removeMemberDevice(deviceId: string): Promise<{ error?: string; done?: string }> {
  await requireManageMembers();
  try {
    const removed = await removeDevice(createAdminClient(), deviceId);
    if (!removed) return { error: "That device is already gone." };
  } catch (reason) {
    console.error("Could not remove a device", reason);
    return { error: "Couldn't remove that device. Try again." };
  }
  revalidatePath("/admin");
  return { done: "Removed." };
}

// REQ-141: turn one of the admin console's module switches on or off for
// the household. Like the notifications switch, the form sends the state
// it wants, not "flip this". Off is a row; on is no row. No module data is
// touched either way.
export async function setModuleOn(
  _previous: ModuleSwitchState,
  formData: FormData,
): Promise<ModuleSwitchState> {
  const key = String(formData.get("module") ?? "");
  if (!SWITCHES.some((each) => each.key === key)) {
    return { error: "Which module?" };
  }
  const on = formData.get("on") === "true";

  const supabase = await createClient();
  if (!(await hasPermission(supabase, "manage_modules"))) {
    redirect("/");
  }
  const { error } = on
    ? await supabase.from("modules_off").delete().eq("module", key)
    : await supabase.from("modules_off").upsert({ module: key }, { onConflict: "module", ignoreDuplicates: true });
  if (error) {
    return { error: error.message };
  }
  // Every page's navigation changes, not just this one.
  revalidatePath("/", "layout");
  return { on };
}
