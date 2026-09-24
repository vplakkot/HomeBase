import { redirect } from "next/navigation";
import type { ComponentProps } from "react";
import { ModuleFrame } from "../../components/module-frame";
import { readAccount } from "../../lib/account";
import { hasPermission } from "../../lib/auth/permissions";
import { readStorage } from "../../lib/storage/storage";
import { createClient } from "../../lib/supabase/server";

// Who is looking at a Storage page, and every entry. Signed-out visitors
// go to sign-in.
export async function storageViewer() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    redirect("/sign-in");
  }
  const [canManageMembers, account, entries] = await Promise.all([
    hasPermission(supabase, "manage_members"),
    readAccount(data.claims),
    readStorage(supabase),
  ]);
  return { supabase, canManageMembers, account, entries };
}

export function StorageFrame(props: Omit<ComponentProps<typeof ModuleFrame>, "slug">) {
  return <ModuleFrame slug="storage" {...props} />;
}
