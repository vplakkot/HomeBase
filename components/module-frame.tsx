import type { CSSProperties, ReactNode } from "react";
import type { Account } from "../lib/account";
import { moduleBySlug, moduleColours, modulesShown } from "../lib/modules";
import { AppFrame } from "./app-frame";
import { MODULE_ICONS } from "./icons";
import { ModuleBar } from "./module-bar";
import styles from "./module-frame.module.css";
import { SectionTabs } from "./section-tabs";

// What a module's home page is called under its title, and only there.
export const OVERVIEW = "Overview";

// Every module page shares the designed header (docs/design/DESIGN.md §6):
// the module's icon and name, with what you're looking at after a dash in
// the module colour ("Finances — September 2026") and a small plain-text
// mark after it ("Closed"), then the header's buttons. Under it, the
// section tabs (desktop) or module bar (phone). A phone has no tabs, so
// the section you're in is named under the title instead. `section` is
// required (#238): only the module's home says "Overview"; any other page
// names its tab, or itself when it's under none. A name that isn't a tab
// lights up no tab.
export function ModuleFrame({
  slug,
  canManageMembers,
  account,
  section,
  context,
  mark,
  actions,
  tabMonth,
  pinnedInHeader,
  pinnedHref,
  children,
}: {
  slug: string;
  canManageMembers: boolean;
  account: Account;
  section: string;
  context?: string;
  mark?: string;
  actions?: ReactNode;
  tabMonth?: string;
  pinnedInHeader?: boolean;
  pinnedHref?: string | null;
  children: ReactNode;
}) {
  const module = moduleBySlug(slug);
  const Icon = MODULE_ICONS[module.slug];
  // The tabs mark Overview when they're given no section.
  const tab = section === OVERVIEW ? undefined : section;
  return (
    <AppFrame
      current={module.slug}
      canAdminister={canManageMembers}
      account={account}
      phoneBar={
        <ModuleBar module={module} others={modulesShown(account.modules)} current={tab} pinnedHref={pinnedHref} />
      }
      style={moduleColours(module) as CSSProperties}
    >
      <header className={styles.header}>
        <div className={styles.name}>
          <span className={styles.chip} aria-hidden="true">
            <Icon size={20} />
          </span>
          <span className={styles.titles}>
            <h1 className={styles.title}>
              {module.name}
              {context ? (
                <>
                  {" "}
                  <span className={styles.dash}>—</span> <span className={styles.context}>{context}</span>
                </>
              ) : null}
              {mark ? <sup className={styles.mark}>{mark}</sup> : null}
            </h1>
            <span className={styles.where}>{section}</span>
          </span>
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </header>
      <SectionTabs module={module} current={tab} month={tabMonth} pinnedInHeader={pinnedInHeader} />
      {children}
    </AppFrame>
  );
}
