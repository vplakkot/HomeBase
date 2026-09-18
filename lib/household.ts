import type { SupabaseClient } from "@supabase/supabase-js";

export const SIGN_UP_CLOSED_MESSAGE =
  "Sign-up is closed. Ask your household admin to create your account.";

export async function householdExists(
  supabase: SupabaseClient,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("household_exists");
  if (error) {
    throw new Error(
      `Could not check whether a household exists: ${error.message}`,
    );
  }
  return data === true;
}
