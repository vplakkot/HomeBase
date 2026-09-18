"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MODE_COOKIE } from "../../lib/auth/mode";
import { hasPermission } from "../../lib/auth/permissions";
import { createClient } from "../../lib/supabase/server";

export async function enterAdminMode() {
  const supabase = await createClient();
  if (!(await hasPermission(supabase, "manage_members"))) {
    redirect("/");
  }

  const store = await cookies();
  // No maxAge on purpose: a session cookie, so closing the app or the
  // browser returns the admin to member view.
  store.set(MODE_COOKIE, "admin", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  redirect("/");
}

export async function leaveAdminMode() {
  const store = await cookies();
  store.delete(MODE_COOKIE);
  redirect("/");
}
