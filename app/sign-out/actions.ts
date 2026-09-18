"use server";

import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";

export async function signOut() {
  const supabase = await createClient();
  // "local" ends this device's session only; the default, "global", would
  // also sign the same person out of their other devices.
  await supabase.auth.signOut({ scope: "local" });
  redirect("/sign-in");
}
