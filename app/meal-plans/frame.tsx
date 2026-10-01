import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ButtonLink } from "../../components/button";
import { ModuleFrame } from "../../components/module-frame";
import { readAccount } from "../../lib/account";
import { hasPermission } from "../../lib/auth/permissions";
import { createClient } from "../../lib/supabase/server";
import styles from "./meal-plans.module.css";

// Who is looking at a Meal Plan page. Signed-out visitors go to sign-in.
export async function mealPlansViewer() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/sign-in");
  const [canManageMembers, account] = await Promise.all([
    hasPermission(supabase, "manage_members"),
    readAccount(data.claims, supabase),
  ]);
  return { canManageMembers, account, supabase, userId: String(data.claims.sub) };
}

export type MealPlansViewer = Awaited<ReturnType<typeof mealPlansViewer>>;

// Every Meal Plan screen: the module header with any tools such as the
// library's search, Add recipe only where `addRecipe` says so (REQ-155:
// the module home and the recipes list; on every other screen it was in
// the way, even under a draft's Save), and
// below the top level a breadcrumb back to the recipes (every page that
// has one is a recipe or a draft, so "Recipes › Test pasta", not "Meal
// Plans › Test pasta", which read as if the recipe were a plan).
export function MealPlansScreen({
  viewer,
  section,
  crumb,
  tools,
  actions,
  addRecipe = false,
  children,
}: {
  viewer: MealPlansViewer;
  section: string;
  crumb?: string;
  tools?: ReactNode;
  actions?: ReactNode;
  addRecipe?: boolean;
  children: ReactNode;
}) {
  return (
    <ModuleFrame
      slug="meal-plans"
      section={section}
      canManageMembers={viewer.canManageMembers}
      account={viewer.account}
      pinnedInHeader
      // No pinned bar on a phone either, where Add recipe isn't wanted.
      pinnedHref={addRecipe ? undefined : null}
      actions={
        actions ?? (
          <div className={styles.tools}>
            {tools}
            {/* A phone has the pinned Add recipe bar; a second button here
                would be the same thing twice. */}
            {addRecipe ? (
              <ButtonLink href="/meal-plans/new" desktopOnly>
                Add recipe
              </ButtonLink>
            ) : null}
          </div>
        )
      }
    >
      <div className={styles.screen}>
        {crumb ? (
          <nav aria-label="Breadcrumb">
            <ol className={styles.crumbs}>
              <li>
                <Link href="/meal-plans/recipes">Recipes</Link>
              </li>
              <li>
                <span aria-hidden="true">› </span>
                <span aria-current="page">{crumb}</span>
              </li>
            </ol>
          </nav>
        ) : null}
        {children}
      </div>
    </ModuleFrame>
  );
}
