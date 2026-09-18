import Link from "next/link";
import { householdExists, SIGN_UP_CLOSED_MESSAGE } from "../../lib/household";
import { createClient } from "../../lib/supabase/server";
import { SignUpForm } from "./sign-up-form";

export default async function SignUpPage() {
  const supabase = await createClient();

  if (await householdExists(supabase)) {
    return (
      <>
        <h1>Sign-up is closed</h1>
        <p>{SIGN_UP_CLOSED_MESSAGE}</p>
        <p>
          <Link href="/sign-in">Sign in</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1>Create your household</h1>
      <p>
        You are the first one here. Signing up creates the household and
        makes you its admin.
      </p>
      <SignUpForm />
    </>
  );
}
