"use server";

import { redirect } from "next/navigation";
import { SIGN_IN_FAILED_MESSAGE } from "../../lib/auth/messages";
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

  redirect("/");
}
