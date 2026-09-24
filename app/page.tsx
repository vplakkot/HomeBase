import { redirect } from "next/navigation";
import { AccountPill } from "../components/account-menu";
import { ActionItems } from "../components/action-items";
import { AppFrame } from "../components/app-frame";
import { BrandLockup } from "../components/brand-lockup";
import { Greeting } from "../components/greeting";
import { ModuleTile } from "../components/module-tile";
import { QuickAdd } from "../components/quick-add";
import { SectionLabel } from "../components/section-label";
import { readAccount } from "../lib/account";
import { hasPermission } from "../lib/auth/permissions";
import { financeItems, financeTile } from "../lib/finances/action-items";
import { householdToday } from "../lib/finances/budget-year";
import { readFinanceSnapshot } from "../lib/finances/snapshot";
import { demoFrom, moduleStatus, mostUrgent } from "../lib/module-status";
import { paperworkTile } from "../lib/paperwork/action-items";
import { countUnfiled } from "../lib/paperwork/paperwork";
import { countEntries, storageTile } from "../lib/storage/storage";
import { NOTHING_SWITCHED_OFF, modulesSwitchedOn } from "../lib/modules";
import { createClient } from "../lib/supabase/server";
import { KeepThisDevice } from "./notifications/enable-notifications";
import styles from "./page.module.css";

// Home (docs/design/DESIGN.md §4). On a phone, top to bottom: the brand
// and the account pill (REQ-85), the greeting, action items, then the
// module tiles, which are the only navigation Home needs; Quick add stays
// fixed at the bottom. On a desktop the sidebar takes over the brand and the way to
// the admin console, and Quick add moves up beside the greeting.
//
// ?demo in the address swaps what the tiles and action items say for the
// design's invented example, so every state can be seen before modules
// have data (a Notion decision of 2026-09-21; lib/module-status.ts).
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    // The proxy already bounces signed-out visitors; this covers any route
    // the proxy's matcher might miss.
    redirect("/sign-in");
  }
  const canManageMembers = await hasPermission(supabase, "manage_members");
  const account = await readAccount(data.claims);
  const demo = demoFrom((await searchParams).demo);
  // The modules with real items: Finances (REQ-91, REQ-93) and Paperwork
  // (REQ-97); Storage (REQ-87) only says how much is logged. The example
  // needs none of it read.
  const live =
    demo === null
      ? await (async () => {
          const [snapshot, unfiled, stored] = await Promise.all([
            readFinanceSnapshot(supabase, householdToday()),
            countUnfiled(supabase),
            countEntries(supabase),
          ]);
          return {
            finances: financeTile(snapshot, financeItems(snapshot, data.claims.sub)),
            paperwork: paperworkTile(unfiled),
            storage: storageTile(stored),
          };
        })()
      : {};
  const modules = modulesSwitchedOn(NOTHING_SWITCHED_OFF).map((module) => ({
    module,
    status: moduleStatus(module, demo, live),
  }));

  return (
    <AppFrame
      current="home"
      canAdminister={canManageMembers}
      account={account}
      phoneBar={<QuickAdd variant="bar" />}
    >
      <header className={styles.header}>
        <BrandLockup />
        <AccountPill account={account} canAdminister={canManageMembers} />
      </header>
      <KeepThisDevice publicKey={account.publicKey} knownDevice={account.knownDevice} />

      <div className={styles.intro}>
        <Greeting name={account.name?.split(/\s+/)[0] ?? null} />
        <div className={styles.desktopQuickAdd}>
          <QuickAdd variant="buttons" />
        </div>
      </div>

      <section className={styles.section} aria-labelledby="action-items">
        <ActionItems labelId="action-items" items={mostUrgent(modules)} />
      </section>

      <section className={styles.section} aria-labelledby="modules">
        <SectionLabel id="modules">Modules</SectionLabel>
        <ul className={styles.tiles}>
          {modules.map(({ module, status }) => (
            <li key={module.slug}>
              <ModuleTile module={module} status={status} />
            </li>
          ))}
        </ul>
      </section>
    </AppFrame>
  );
}
