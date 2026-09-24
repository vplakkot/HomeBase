import { redirect } from "next/navigation";
import { ModuleFrame } from "../../components/module-frame";
import { readAccount } from "../../lib/account";
import { hasPermission } from "../../lib/auth/permissions";
import { createClient } from "../../lib/supabase/server";

// Who is looking at a Finances page, and what they may do there. Signed-out
// visitors go to sign-in.
export async function financesViewer() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    redirect("/sign-in");
  }
  const [canManageMembers, canManageBudget, account] = await Promise.all([
    hasPermission(supabase, "manage_members"),
    hasPermission(supabase, "manage_budget"),
    readAccount(data.claims),
  ]);
  return { supabase, canManageMembers, canManageBudget, account, userId: data.claims.sub };
}

// Every Finances page shares the module header and navigation
// (components/module-frame.tsx). Only pages about a month show the month
// picker and status chip: the module's home and Monthly entry.
export function FinancesFrame(props: Omit<Parameters<typeof ModuleFrame>[0], "slug">) {
  return <ModuleFrame slug="finances" {...props} />;
}
