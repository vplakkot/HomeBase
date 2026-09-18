"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "../../lib/supabase/admin";
import { createClient } from "../../lib/supabase/server";

export type SetPasswordState = { error?: string };

export async function setPassword(
  _previous: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (password.length < 8) {
    return { error: "Use at least 8 characters." };
  }
  if (password !== confirmation) {
    return { error: "The two passwords don't match." };
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) {
    redirect("/sign-in");
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: error.message };
  }

  const admin = createAdminClient();
  const { error: flagError } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { must_set_password: false },
  });
  if (flagError) {
    return {
      error: `The password was changed, but the reminder could not be cleared: ${flagError.message}`,
    };
  }

  // The token in the cookie still says must_set_password; fetch a fresh one.
  await supabase.auth.refreshSession();
  redirect("/");
}
