import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminPill } from "../components/admin-pill";
import { ActionItems } from "../components/action-items";
import { AppFrame } from "../components/app-frame";
import { BrandLockup } from "../components/brand-lockup";
import { Greeting } from "../components/greeting";
import { ModuleTile } from "../components/module-tile";
import { QuickAdd } from "../components/quick-add";
import { SectionLabel } from "../components/section-label";
import { hasPermission } from "../lib/auth/permissions";
import { demoFrom, moduleStatus, mostUrgent } from "../lib/module-status";
import { NOTHING_SWITCHED_OFF, modulesSwitchedOn } from "../lib/modules";
import { DEVICE_COOKIE } from "../lib/notifications/device";
import { createClient } from "../lib/supabase/server";
import { EnableNotifications } from "./notifications/enable-notifications";
import styles from "./page.module.css";
import { SignOutForm } from "./sign-out/sign-out-form";

function getBuildInfo() {
  const ref = process.env.VERCEL_GIT_COMMIT_REF || "dev";
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  const commit = sha ? sha.slice(0, 7) : "local";
  return `${ref} · ${commit}`;
}

// The first word of the name an admin gave the account, if any. The
// household's first account was made by signing up, which never asked for
// a name, so it has none and Home just says "Morning".
function firstName(metadata: unknown): string | null {
  const name = (metadata as { name?: unknown } | undefined)?.name;
  if (typeof name !== "string") return null;
  return name.trim().split(/\s+/)[0] || null;
}

// Home (docs/design/DESIGN.md §4). On a phone, top to bottom: the brand
// and the Admin pill, the greeting, action items, then the module tiles,
// which are the only navigation Home needs; Quick add stays fixed at the
// bottom. On a desktop the sidebar takes over the brand and the way to
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
  const email = data.claims.email ?? null;
  const canManageMembers = await hasPermission(supabase, "manage_members");
  const cookieStore = await cookies();
  const demo = demoFrom((await searchParams).demo);
  const modules = modulesSwitchedOn(NOTHING_SWITCHED_OFF).map((module) => ({
    module,
    status: moduleStatus(module, demo),
  }));

  return (
    <AppFrame
      current="home"
      canAdminister={canManageMembers}
      phoneBar={<QuickAdd variant="bar" />}
    >
      <header className={styles.header}>
        <BrandLockup />
        {canManageMembers ? <AdminPill /> : null}
      </header>

      <div className={styles.intro}>
        <Greeting name={firstName(data.claims.user_metadata)} />
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

      {/* Not in the design: these move into a profile menu later (a Draft
          requirement). Until then they stay on Home, where v0.1 had them. */}
      <section className={styles.section} aria-labelledby="account">
        <SectionLabel id="account">Account</SectionLabel>
        <p className={styles.signedIn}>{email ? `Signed in as ${email}` : "Signed in"}</p>
        <EnableNotifications
          publicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY}
          knownDevice={cookieStore.get(DEVICE_COOKIE)?.value ?? null}
        />
        <SignOutForm />
        <p data-testid="build-info" className={styles.build}>
          {getBuildInfo()}
        </p>
      </section>
    </AppFrame>
  );
}
