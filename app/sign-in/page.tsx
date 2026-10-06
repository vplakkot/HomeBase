import Link from "next/link";
import { AuthPage } from "../../components/auth-page";
import { householdExists } from "../../lib/household";
import { createClient } from "../../lib/supabase/server";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage({
  searchParams,
}: { searchParams?: Promise<{ link?: string }> } = {}) {
  const { link } = (await searchParams) ?? {};
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
      {link === "email-changed" ? (
        <p role="status">Your email is changed. Sign in with the new address and your password.</p>
      ) : null}
      {link === "invalid" ? (
        <p role="alert">That link has expired or was already used. Ask for a new one below.</p>
      ) : null}
      <SignInForm />
      <p>
        <Link href="/forgot-password">Forgot your password?</Link>
      </p>
    </AuthPage>
  );
}
