import type { CSSProperties, ReactNode } from "react";
import type { Account } from "../lib/account";
import { moduleBySlug, moduleColours } from "../lib/modules";
import { AppFrame } from "./app-frame";
import { MODULE_ICONS } from "./icons";
import { ModuleBar } from "./module-bar";
import { MonthPicker } from "./month-picker";
import styles from "./module-frame.module.css";
import { SectionTabs } from "./section-tabs";

// Every module page shares the designed header (docs/design/DESIGN.md §7)
// and the section tabs (desktop) or module bar (phone). A phone has no
// tabs, so the section you're in is named under the title instead. The
// month picker and status chip belong to a month, so only pages about one
// show them.
export function ModuleFrame({
  slug,
  canManageMembers,
  account,
  section,
  status,
  month,
  children,
}: {
  slug: string;
  canManageMembers: boolean;
  account: Account;
  section?: string;
  status?: string;
  month?: { current: string; options: string[] };
  children: ReactNode;
}) {
  const module = moduleBySlug(slug);
  const Icon = MODULE_ICONS[module.slug];
  return (
    <AppFrame
      current={module.slug}
      canAdminister={canManageMembers}
      account={account}
      phoneBar={<ModuleBar module={module} current={section} />}
      style={moduleColours(module) as CSSProperties}
    >
      <header className={styles.header}>
        <div className={styles.name}>
          <span className={styles.chip} aria-hidden="true">
            <Icon size={20} />
          </span>
          <span className={styles.titles}>
            <h1 className={styles.title}>{module.name}</h1>
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
      <SectionTabs module={module} current={section} />
      {children}
    </AppFrame>
  );
}
