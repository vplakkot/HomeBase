import Link from "next/link";
import { householdExists } from "../lib/household";
import { createClient } from "../lib/supabase/server";

function getBuildInfo() {
  const ref = process.env.VERCEL_GIT_COMMIT_REF || "dev";
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  const commit = sha ? sha.slice(0, 7) : "local";
  return `${ref} · ${commit}`;
}

export default async function HomePage() {
  const supabase = await createClient();
  const exists = await householdExists(supabase);

  return (
    <>
      <h1>HomeBase</h1>
      <p>
        {exists ? (
          <Link href="/sign-in">Sign in</Link>
        ) : (
          <Link href="/sign-up">Create your household</Link>
        )}
      </p>
      <p
        data-testid="build-info"
        style={{ fontSize: "0.75rem", color: "#888", marginTop: "3rem" }}
      >
        {getBuildInfo()}
      </p>
    </>
  );
}
