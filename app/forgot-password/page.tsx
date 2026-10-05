import Link from "next/link";
import { AuthPage } from "../../components/auth-page";
import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <AuthPage>
      <h1>Forgot your password?</h1>
      <p>Type your email and we&apos;ll send a link to choose a new one.</p>
      <ForgotPasswordForm />
      <p>
        <Link href="/sign-in">Back to sign in</Link>
      </p>
    </AuthPage>
  );
}
