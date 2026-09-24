import type { SupabaseClient } from "@supabase/supabase-js";
import type { FinanceSnapshot } from "./action-items";
import { listBalances } from "./balances";
import { listBills } from "./bills";
import { listPeople, listSplits, type Person } from "./budget-year";
import { readMonthsSince } from "./month";

// Everything Finances' action items are worked out from (REQ-93), read in
// one go. Signed in, the database hands back only the viewer's own
// acknowledgements; the push job, reading with the secret key, gets
// everyone's, and passes the people in itself (see householdForJob).
export async function readFinanceSnapshot(
  supabase: SupabaseClient,
  today: string,
  people?: Person[],
): Promise<FinanceSnapshot> {
  const [year, month] = today.split("-").map(Number);
  const yearAgo = `${year - 1}-${String(month).padStart(2, "0")}-01`;
  const [who, splits, bills, months, balances, acks] = await Promise.all([
    people ?? listPeople(supabase),
    listSplits(supabase),
    listBills(supabase),
    readMonthsSince(supabase, yearAgo),
    listBalances(supabase),
    supabase.from("action_item_acks").select("user_id, key"),
  ]);
  if (acks.error) throw new Error(`Could not read the acknowledgements: ${acks.error.message}`);
  return {
    today,
    people: who,
    splits,
    billCount: bills.length,
    months,
    balances,
    acks: (acks.data ?? []) as { user_id: string; key: string }[],
  };
}

// The household as the push job sees it. household_people() answers only
// a signed-in member, so this reads the tables directly with the secret
// key. Names aren't needed: no push carries one.
export async function householdForJob(admin: SupabaseClient): Promise<Person[]> {
  const [members, admins] = await Promise.all([
    admin.from("household_members").select("user_id, role_id"),
    admin.from("role_permissions").select("role_id").eq("permission", "manage_budget"),
  ]);
  if (members.error) throw new Error(`Could not read the household: ${members.error.message}`);
  if (admins.error) throw new Error(`Could not read the permissions: ${admins.error.message}`);
  const managing = new Set(((admins.data ?? []) as { role_id: string }[]).map((row) => row.role_id));
  return ((members.data ?? []) as { user_id: string; role_id: string }[]).map((member) => ({
    user_id: member.user_id,
    name: "",
    manages_budget: managing.has(member.role_id),
  }));
}

// Records that a person has seen or acknowledged an item. Seeing it twice
// is fine: the second write changes nothing.
export async function acknowledge(supabase: SupabaseClient, key: string): Promise<void> {
  const { error } = await supabase
    .from("action_item_acks")
    .upsert({ key }, { onConflict: "user_id,key", ignoreDuplicates: true });
  if (error) throw new Error(`Could not record that: ${error.message}`);
}
