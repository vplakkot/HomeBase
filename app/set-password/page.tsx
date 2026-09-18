import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { signOut } from "../sign-out/actions";
import { SetPasswordForm } from "./set-password-form";

export default async function SetPasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    redirect("/sign-in");
  }

  return (
    <>
      <h1>Set a new password</h1>
      <p>
        You signed in with a temporary password. Choose your own before
        going any further.
      </p>
      <SetPasswordForm />
      <form action={signOut}>
        <button type="submit">Sign out</button>
      </form>
    </>
  );
}
