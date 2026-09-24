import { redirect } from "next/navigation";
import type { ComponentProps } from "react";
import { ModuleFrame } from "../../components/module-frame";
import { readAccount } from "../../lib/account";
import { hasPermission } from "../../lib/auth/permissions";
import { listPeople } from "../../lib/finances/budget-year";
import { readPaperwork } from "../../lib/paperwork/paperwork";
import { readStorage } from "../../lib/storage/storage";
import { createClient } from "../../lib/supabase/server";

// Who is looking at a Paperwork page, what they may do there, and
// everything Paperwork holds, with Storage's entries for the boxes files
// are archived in (REQ-98). Signed-out visitors go to sign-in.
export async function paperworkViewer() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    redirect("/sign-in");
  }
  const [canManageMembers, canManagePaperwork, account, people, paperwork, storage] = await Promise.all([
    hasPermission(supabase, "manage_members"),
    hasPermission(supabase, "manage_paperwork"),
    readAccount(data.claims),
    listPeople(supabase),
    readPaperwork(supabase),
    readStorage(supabase),
  ]);
  return { canManageMembers, canManagePaperwork, account, people, ...paperwork, storage };
}

export function PaperworkFrame(props: Omit<ComponentProps<typeof ModuleFrame>, "slug">) {
  return <ModuleFrame slug="paperwork" {...props} />;
}
