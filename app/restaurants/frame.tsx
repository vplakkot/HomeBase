import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ButtonLink } from "../../components/button";
import { ModuleFrame } from "../../components/module-frame";
import { readAccount } from "../../lib/account";
import { hasPermission } from "../../lib/auth/permissions";
import { readPeople } from "../../lib/drinks/drinks";
import { readAnswers, readRestaurants } from "../../lib/restaurants/restaurants";
import { createClient } from "../../lib/supabase/server";
import styles from "./restaurants.module.css";

// Who is looking at a Restaurants page, every saved place, everyone's
// go-again answers, and the household by name. Signed-out visitors go to
// sign-in.
export async function restaurantsViewer() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/sign-in");
  const [canManageMembers, account, restaurants, answers, people] = await Promise.all([
    hasPermission(supabase, "manage_members"),
    readAccount(data.claims, supabase),
    readRestaurants(supabase),
    readAnswers(supabase),
    readPeople(supabase),
  ]);
  return { userId: data.claims.sub, canManageMembers, account, restaurants, answers, people };
}

export type RestaurantsViewer = Awaited<ReturnType<typeof restaurantsViewer>>;

// Every Restaurants screen: the module header with Add place (a desktop's;
// a phone has it pinned above the bottom bar), and below the top level a
// breadcrumb back to Want to try, or Been to for a tried place. `section` names the screen under the
// title on a phone.
export function RestaurantsScreen({
  viewer,
  section,
  crumb,
  beenTo = false,
  actions,
  children,
}: {
  viewer: RestaurantsViewer;
  section: string;
  crumb?: string;
  // The crumb's parent: Want to try unless it's a tried place.
  beenTo?: boolean;
  // In place of Add place; null for none.
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ModuleFrame
      slug="restaurants"
      section={section}
      canManageMembers={viewer.canManageMembers}
      account={viewer.account}
      pinnedInHeader
      actions={
        actions === undefined ? (
          <ButtonLink href="/restaurants/new" desktopOnly>
            Add place
          </ButtonLink>
        ) : (
          actions
        )
      }
    >
      <div className={styles.screen}>
        {crumb ? (
          <nav aria-label="Breadcrumb">
            <ol className={styles.crumbs}>
              <li>
                {beenTo ? <Link href="/restaurants/been-to">Been to</Link> : <Link href="/restaurants">Want to try</Link>}
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
