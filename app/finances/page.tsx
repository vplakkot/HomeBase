import { redirect } from "next/navigation";
import { AppFrame } from "../../components/app-frame";
import { ModuleBar } from "../../components/module-bar";
import { hasPermission } from "../../lib/auth/permissions";
import { moduleBySlug } from "../../lib/modules";
import { createClient } from "../../lib/supabase/server";
import styles from "./page.module.css";

// The Finances module's home: an empty shell in v0.2, open to admins and
// members alike. REQ-17 gives it the designed header; the finances
// themselves arrive in v1.0.
export default async function FinancesPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    redirect("/sign-in");
  }
  const canManageMembers = await hasPermission(supabase, "manage_members");
  const finances = moduleBySlug("finances");

  return (
    <AppFrame
      current={finances.slug}
      canAdminister={canManageMembers}
      phoneBar={<ModuleBar module={finances} />}
    >
      <h1 className={styles.title}>{finances.name}</h1>
      <p className={styles.soon}>
        Coming soon. This is where the month&apos;s bills, payments and savings
        will live.
      </p>
    </AppFrame>
  );
}
