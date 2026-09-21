import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminPill } from "../components/admin-pill";
import { BrandLockup } from "../components/brand-lockup";
import { hasPermission } from "../lib/auth/permissions";
import { createClient } from "../lib/supabase/server";
import { DEVICE_COOKIE } from "../lib/notifications/device";
import { EnableNotifications } from "./notifications/enable-notifications";
import styles from "./page.module.css";
import { SignOutForm } from "./sign-out/sign-out-form";

function getBuildInfo() {
  const ref = process.env.VERCEL_GIT_COMMIT_REF || "dev";
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  const commit = sha ? sha.slice(0, 7) : "local";
  return `${ref} · ${commit}`;
}

export default async function HomePage() {
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

  return (
    <>
      <header className={styles.header}>
        <BrandLockup />
        {canManageMembers ? <AdminPill /> : null}
      </header>
      <p>{email ? `Signed in as ${email}` : "Signed in"}</p>
      <EnableNotifications
        publicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY}
        knownDevice={cookieStore.get(DEVICE_COOKIE)?.value ?? null}
      />
      <SignOutForm />
      <p
        data-testid="build-info"
        style={{
          fontSize: "var(--text-caption)",
          color: "var(--color-muted)",
          marginTop: "var(--space-9)",
        }}
      >
        {getBuildInfo()}
      </p>
    </>
  );
}
