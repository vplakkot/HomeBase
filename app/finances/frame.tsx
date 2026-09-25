import type { ComponentProps } from "react";
import { redirect } from "next/navigation";
import { ButtonLink } from "../../components/button";
import { SettingsIcon } from "../../components/icons";
import { ModuleFrame } from "../../components/module-frame";
import { readAccount } from "../../lib/account";
import { hasPermission } from "../../lib/auth/permissions";
import { householdToday, monthLabel } from "../../lib/finances/budget-year";
import { monthMark } from "../../lib/finances/month";
import { createClient } from "../../lib/supabase/server";

// Who is looking at a Finances page, and what they may do there. Signed-out
// visitors go to sign-in.
export async function financesViewer() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    redirect("/sign-in");
  }
  const [canManageMembers, canManageBudget, account] = await Promise.all([
    hasPermission(supabase, "manage_members"),
    hasPermission(supabase, "manage_budget"),
    readAccount(data.claims),
  ]);
  return { supabase, canManageMembers, canManageBudget, account, userId: data.claims.sub };
}

// Every Finances page shares the module header and navigation
// (components/module-frame.tsx, DESIGN.md §7). A page about a month names
// it in the title — "Finances — September 2026" — with "Closed" or "Open"
// after a past one (REQ-102), and its tabs keep that month. The header's
// buttons: Previous months (History), the settings gear for an admin
// (Budget year), and Log payment while the month can take one.
export function FinancesFrame({
  canManageBudget,
  month,
  ...props
}: Omit<ComponentProps<typeof ModuleFrame>, "slug" | "context" | "mark" | "actions" | "tabMonth" | "pinnedInHeader"> & {
  canManageBudget: boolean;
  month?: { startsOn: string; closed: boolean };
}) {
  const mark = month ? monthMark(month.closed, month.startsOn, householdToday()) : undefined;
  const at = month && mark ? month.startsOn.slice(0, 7) : undefined;
  return (
    <ModuleFrame
      slug="finances"
      context={month ? monthLabel(month.startsOn) : undefined}
      mark={mark}
      tabMonth={at}
      pinnedInHeader
      actions={
        <>
          <ButtonLink href="/finances/history">Previous months</ButtonLink>
          {canManageBudget ? (
            <ButtonLink href="/finances/budget-year" label="Finances settings">
              <SettingsIcon size={20} />
            </ButtonLink>
          ) : null}
          {month?.closed ? null : (
            <ButtonLink href={at ? `/finances/log-payment?month=${at}` : "/finances/log-payment"} desktopOnly>
              Log payment
            </ButtonLink>
          )}
        </>
      }
      {...props}
    />
  );
}
