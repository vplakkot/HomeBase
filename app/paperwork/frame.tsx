import { redirect } from "next/navigation";
import type { ComponentProps } from "react";
import { ModuleFrame } from "../../components/module-frame";
import { readAccount } from "../../lib/account";
import { hasPermission } from "../../lib/auth/permissions";
import { listPeople } from "../../lib/finances/budget-year";
import { readPaperwork } from "../../lib/paperwork/paperwork";
import { createClient } from "../../lib/supabase/server";

// Who is looking at a Paperwork page, what they may do there, and
// everything Paperwork holds. Signed-out visitors go to sign-in.
export async function paperworkViewer() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    redirect("/sign-in");
  }
  const [canManageMembers, canManagePaperwork, account, people, paperwork] = await Promise.all([
    hasPermission(supabase, "manage_members"),
    hasPermission(supabase, "manage_paperwork"),
    readAccount(data.claims),
    listPeople(supabase),
    readPaperwork(supabase),
  ]);
  return { canManageMembers, canManagePaperwork, account, people, ...paperwork };
}

export function PaperworkFrame(props: Omit<ComponentProps<typeof ModuleFrame>, "slug">) {
  return <ModuleFrame slug="paperwork" {...props} />;
}
