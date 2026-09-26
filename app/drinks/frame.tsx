import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ButtonLink } from "../../components/button";
import { ModuleFrame } from "../../components/module-frame";
import { readAccount } from "../../lib/account";
import { hasPermission } from "../../lib/auth/permissions";
import { readDrinks, readPeople } from "../../lib/drinks/drinks";
import { signedPhotoLinks, thumbPath } from "../../lib/drinks/photos";
import { createClient } from "../../lib/supabase/server";
import { ScanButton } from "./scan-button";
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
  // REQ-30, REQ-32: the list's thumbnails, as short-lived private links.
  const thumbs = await signedPhotoLinks(
    supabase,
    stored.drinks.flatMap((drink) => (drink.front_label ? [thumbPath(drink.front_label)] : [])),
  );
  return { canManageMembers, account, userId: data.claims.sub as string, people, thumbs, supabase, ...stored };
}

export type DrinksViewer = Awaited<ReturnType<typeof drinksViewer>>;

// Every Drinks screen: the module header with Add by hand and Scan, and
// below the top level a breadcrumb back to the list it came from
// (REQ-121: Wines, or Want to try for a wish). The scan is a screen of
// its own (REQ-122): its Cancel in place of the header's buttons.
export function DrinksScreen({
  viewer,
  section,
  crumb,
  parent,
  tools,
  actions,
  children,
}: {
  viewer: DrinksViewer;
  section?: string;
  crumb?: string;
  parent?: { name: string; href: string };
  tools?: ReactNode;
  // In place of Add by hand and Scan.
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ModuleFrame
      slug="drinks"
      section={section}
      canManageMembers={viewer.canManageMembers}
      account={viewer.account}
      actions={
        actions ?? (
          <div className={styles.tools}>
            {tools}
            <ButtonLink href="/drinks/new">Add by hand</ButtonLink>
            <ScanButton />
          </div>
        )
      }
    >
      <div className={styles.screen}>
        {crumb ? (
          <nav aria-label="Breadcrumb">
            <ol className={styles.crumbs}>
              <li>
                <Link href="/drinks">Drinks</Link>
              </li>
              {parent ? (
                <li>
                  <span aria-hidden="true">› </span>
                  <Link href={parent.href}>{parent.name}</Link>
                </li>
              ) : null}
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
