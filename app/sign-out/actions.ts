"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MODE_COOKIE } from "../../lib/auth/mode";
import { DEVICE_COOKIE } from "../../lib/notifications/device";
import { createClient } from "../../lib/supabase/server";

export async function signOut() {
  const supabase = await createClient();
  const store = await cookies();

  // Ending notifications for this device comes first, while the session is
  // still valid: the database only lets each person remove their own. The
  // sender reaches devices listed in the table, so removing the row is what
  // stops notifications arriving here. Their other devices keep theirs.
  const device = store.get(DEVICE_COOKIE)?.value;
  if (device) {
    await supabase.from("push_subscriptions").delete().eq("endpoint", device);
    store.delete(DEVICE_COOKIE);
  }

  // "local" ends this device's session only; the default, "global", would
  // also sign the same person out of their other devices.
  await supabase.auth.signOut({ scope: "local" });
  // Signing back in is a new session: it starts in member view.
  store.delete(MODE_COOKIE);
  redirect("/sign-in");
}
