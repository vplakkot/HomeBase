import { redirect } from "next/navigation";
import { createClient } from "../lib/supabase/server";
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

  return (
    <>
      <h1>HomeBase</h1>
      <p>{email ? `Signed in as ${email}` : "Signed in"}</p>
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
