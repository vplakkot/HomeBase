import Link from "next/link";
import { redirect } from "next/navigation";
import { hasPermission } from "../../lib/auth/permissions";
import { createClient } from "../../lib/supabase/server";
import { CreateMemberForm } from "./create-member-form";

export default async function AdminPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    redirect("/sign-in");
  }
  if (!(await hasPermission(supabase, "manage_members"))) {
    redirect("/");
  }

  return (
    <>
      <h1>Admin console</h1>
      <section aria-labelledby="members-heading">
        <h2 id="members-heading">Members</h2>
        <h3>Create a member account</h3>
        <CreateMemberForm />
      </section>
      <p>
        <Link href="/">Back to home</Link>
      </p>
    </>
  );
}
