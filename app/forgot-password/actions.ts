"use server";

import { headers } from "next/headers";
import { cleanEmail, confirmUrl, EMAIL_INVALID_MESSAGE, emailErrorMessage } from "../../lib/auth/email";
import { createEphemeralClient } from "../../lib/supabase/ephemeral";

export type ForgotPasswordState = { error?: string; sent?: boolean };

// #80: someone locked out asks for a link to choose a new password. The
// answer is the same whether or not the address has an account, so this
// page can't be used to find out who is in the household. Supabase sends
// the email only for an address that has one.
export async function requestPasswordReset(
  _previous: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = cleanEmail(formData.get("email"));
  if (!email) return { error: EMAIL_INVALID_MESSAGE };
  const { error } = await createEphemeralClient().auth.resetPasswordForEmail(email, {
    redirectTo: confirmUrl((await headers()).get("host")),
  });
  if (error) {
    console.error("requestPasswordReset failed", error.code, error.message);
    return { error: emailErrorMessage(error) };
  }
  return { sent: true };
}
