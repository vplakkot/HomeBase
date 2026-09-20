"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SIGN_IN_FAILED_MESSAGE } from "../../lib/auth/messages";
import { DEVICE_COOKIE } from "../../lib/notifications/device";
import { createClient } from "../../lib/supabase/server";

export type SignInState = { error?: string };

export async function signIn(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: SIGN_IN_FAILED_MESSAGE };
  }

  // Any note about this device belongs to whoever was signed in before.
  // Without this, their leftover note would decide what this person sees,
  // and notifications here start with a deliberate tap either way.
  (await cookies()).delete(DEVICE_COOKIE);

  redirect("/");
}
