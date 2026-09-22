import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import { AppFrame } from "../../components/app-frame";
import { MODULE_ICONS } from "../../components/icons";
import { ModuleBar } from "../../components/module-bar";
import { MonthPicker } from "../../components/month-picker";
import { SectionTabs } from "../../components/section-tabs";
import { hasPermission } from "../../lib/auth/permissions";
import { moduleBySlug, moduleColours } from "../../lib/modules";
import { createClient } from "../../lib/supabase/server";
import styles from "./page.module.css";

// The Finances module's home: an empty shell in v0.2, open to admins and
// members alike, with the designed header (docs/design/DESIGN.md §7): the
// module's icon and name, the month and its status. No budget year exists
// until v1.0 sets one up, so the status says so. On a desktop the sections
// sit in tabs below; on a phone they're in the Sections sheet.
export default async function FinancesPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    redirect("/sign-in");
  }
  const canManageMembers = await hasPermission(supabase, "manage_members");
  const finances = moduleBySlug("finances");
  const Icon = MODULE_ICONS[finances.slug];

  return (
    <AppFrame
      current={finances.slug}
      canAdminister={canManageMembers}
      phoneBar={<ModuleBar module={finances} />}
    >
      <header className={styles.header} style={moduleColours(finances) as CSSProperties}>
        <div className={styles.name}>
          <span className={styles.chip} aria-hidden="true">
            <Icon size={20} />
          </span>
          <h1 className={styles.title}>{finances.name}</h1>
        </div>
        <div className={styles.month}>
          <MonthPicker />
          <span className={styles.status}>No budget year</span>
        </div>
      </header>
      <SectionTabs module={finances} />
      <p className={styles.soon}>
        Coming soon. This is where the month&apos;s bills, payments and savings
        will live.
      </p>
    </AppFrame>
  );
}
