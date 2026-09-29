import { redirect } from "next/navigation";
import { AuthPage } from "../../../components/auth-page";
import { hasPermission } from "../../../lib/auth/permissions";
import { modulesChosen } from "../../../lib/module-switches";
import { SWITCHES } from "../../../lib/modules";
import { createClient } from "../../../lib/supabase/server";
import { ChooseForm } from "./choose-form";

// REQ-142: the last step of setting up a household, which until now was
// only the first sign-up. Its admin sees it once, before Home; anyone
// else, or once it's done, goes straight to Home.
export default async function ChooseModulesPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    redirect("/sign-in");
  }
  const [canManageModules, chosen] = await Promise.all([
    hasPermission(supabase, "manage_modules"),
    modulesChosen(supabase),
  ]);
  if (!canManageModules || chosen) {
    redirect("/");
  }

  return (
    <AuthPage>
      <h1>Choose your modules</h1>
      <p>Untick any you won&rsquo;t use. You can turn them on later in the admin console.</p>
      <ChooseForm switches={SWITCHES.map(({ key, name }) => ({ key, name }))} />
    </AuthPage>
  );
}
