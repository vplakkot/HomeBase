import Link from "next/link";
import { AuthPage } from "../../components/auth-page";
import { householdExists } from "../../lib/household";
import { createClient } from "../../lib/supabase/server";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage() {
  const supabase = await createClient();

  if (!(await householdExists(supabase))) {
    return (
      <AuthPage>
        <h1>No household yet</h1>
        <p>Nobody has signed up. The first person to do so creates the household.</p>
        <p>
          <Link href="/sign-up">Create your household</Link>
        </p>
      </AuthPage>
    );
  }

  return (
    <AuthPage>
      <h1>Sign in</h1>
      <SignInForm />
    </AuthPage>
  );
}
