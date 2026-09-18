import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readMode } from "../lib/auth/mode";
import { hasPermission } from "../lib/auth/permissions";
import { createClient } from "../lib/supabase/server";
import { enterAdminMode, leaveAdminMode } from "./mode/actions";
import { signOut } from "./sign-out/actions";

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
  const mode = readMode(await cookies());

  return (
    <>
      <h1>HomeBase</h1>
      <p>{email ? `Signed in as ${email}` : "Signed in"}</p>
      {canManageMembers && mode === "admin" ? (
        <section aria-label="Admin mode">
          <p>
            <strong>Admin mode</strong> · <Link href="/admin">Admin console</Link>
          </p>
          <form action={leaveAdminMode}>
            <button type="submit">Back to member view</button>
          </form>
        </section>
      ) : null}
      {canManageMembers && mode === "member" ? (
        <form action={enterAdminMode}>
          <button type="submit">Enter admin mode</button>
        </form>
      ) : null}
      <form action={signOut}>
        <button type="submit">Sign out</button>
      </form>
      <p
        data-testid="build-info"
        style={{ fontSize: "0.75rem", color: "#888", marginTop: "3rem" }}
      >
        {getBuildInfo()}
      </p>
    </>
  );
}
