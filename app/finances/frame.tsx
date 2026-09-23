import { redirect } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { AppFrame } from "../../components/app-frame";
import { MODULE_ICONS } from "../../components/icons";
import { ModuleBar } from "../../components/module-bar";
import { MonthPicker } from "../../components/month-picker";
import { SectionTabs } from "../../components/section-tabs";
import { readAccount, type Account } from "../../lib/account";
import { hasPermission } from "../../lib/auth/permissions";
import { moduleBySlug, moduleColours } from "../../lib/modules";
import { createClient } from "../../lib/supabase/server";
import styles from "./page.module.css";

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
  return { supabase, canManageMembers, canManageBudget, account };
}

// Every Finances page shares the designed header (docs/design/DESIGN.md §7)
// and the section tabs (desktop) or module bar (phone). A phone has no
// tabs, so the section you're in is named under the title instead. The month picker
// and status chip belong to the month, so only pages about a month show
// them: the module's home and Monthly entry.
export function FinancesFrame({
  canManageMembers,
  account,
  section,
  status,
  month,
  children,
}: {
  canManageMembers: boolean;
  account: Account;
  section?: string;
  status?: string;
  month?: { current: string; options: string[] };
  children: ReactNode;
}) {
  const finances = moduleBySlug("finances");
  const Icon = MODULE_ICONS[finances.slug];
  return (
    <AppFrame
      current={finances.slug}
      canAdminister={canManageMembers}
      account={account}
      phoneBar={<ModuleBar module={finances} current={section} />}
      style={moduleColours(finances) as CSSProperties}
    >
      <header className={styles.header}>
        <div className={styles.name}>
          <span className={styles.chip} aria-hidden="true">
            <Icon size={20} />
          </span>
          <span className={styles.titles}>
            <h1 className={styles.title}>{finances.name}</h1>
            <span className={styles.where}>{section ?? "Overview"}</span>
          </span>
        </div>
        {status ? (
          <div className={styles.month}>
            {month ? <MonthPicker current={month.current} options={month.options} /> : null}
            <span className={styles.status}>{status}</span>
          </div>
        ) : null}
      </header>
      <SectionTabs module={finances} current={section} />
      {children}
    </AppFrame>
  );
}
