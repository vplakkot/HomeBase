import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ButtonLink } from "../../components/button";
import { ModuleFrame } from "../../components/module-frame";
import { readAccount } from "../../lib/account";
import { hasPermission } from "../../lib/auth/permissions";
import { readDrinks, readPeople } from "../../lib/drinks/drinks";
import { createClient } from "../../lib/supabase/server";
import styles from "./drinks.module.css";

// Who is looking at a Drinks page, every drink and rating, and the
// household by name. Signed-out visitors go to sign-in.
export async function drinksViewer() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    redirect("/sign-in");
  }
  const [canManageMembers, account, stored, people] = await Promise.all([
    hasPermission(supabase, "manage_members"),
    readAccount(data.claims),
    readDrinks(supabase),
    readPeople(supabase),
  ]);
  return { canManageMembers, account, userId: data.claims.sub as string, people, ...stored };
}

export type DrinksViewer = Awaited<ReturnType<typeof drinksViewer>>;

// Every Drinks screen: the module header with Add a drink, and below the
// top level a breadcrumb back to the list.
export function DrinksScreen({
  viewer,
  section,
  crumb,
  tools,
  children,
}: {
  viewer: DrinksViewer;
  section?: string;
  crumb?: string;
  tools?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ModuleFrame
      slug="drinks"
      section={section}
      canManageMembers={viewer.canManageMembers}
      account={viewer.account}
      actions={
        <div className={styles.tools}>
          {tools}
          <ButtonLink href="/drinks/new">Add a drink</ButtonLink>
        </div>
      }
    >
      <div className={styles.screen}>
        {crumb ? (
          <nav aria-label="Breadcrumb">
            <ol className={styles.crumbs}>
              <li>
                <Link href="/drinks">Drinks</Link>
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
