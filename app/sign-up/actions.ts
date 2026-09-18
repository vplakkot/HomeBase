"use server";

import { redirect } from "next/navigation";
import { householdExists, SIGN_UP_CLOSED_MESSAGE } from "../../lib/household";
import { createClient } from "../../lib/supabase/server";

export type SignUpState = { error?: string };

export async function signUp(
  _previous: SignUpState,
  formData: FormData,
): Promise<SignUpState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createClient();
  if (await householdExists(supabase)) {
    return { error: SIGN_UP_CLOSED_MESSAGE };
  }

  const { error } = await supabase.auth.signUp({ email, password });
  if (error) {
    // The database trigger refuses every sign-up after the first. Don't
    // depend on how Supabase words that; re-check and say why ourselves.
    if (await householdExists(supabase)) {
      return { error: SIGN_UP_CLOSED_MESSAGE };
    }
    return { error: error.message };
  }

  redirect("/");
}
