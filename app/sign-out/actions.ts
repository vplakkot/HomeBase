"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MODE_COOKIE } from "../../lib/auth/mode";
import { createClient } from "../../lib/supabase/server";

export async function signOut() {
  const supabase = await createClient();
  // "local" ends this device's session only; the default, "global", would
  // also sign the same person out of their other devices.
  await supabase.auth.signOut({ scope: "local" });
  // Signing back in is a new session: it starts in member view.
  (await cookies()).delete(MODE_COOKIE);
  redirect("/sign-in");
}
