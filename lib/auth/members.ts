import type { SupabaseClient } from "@supabase/supabase-js";

export type Member = {
  user_id: string;
  name: string | null;
  email: string;
  role_id: string;
  role_name: string;
};

export type Role = { id: string; name: string };

export async function listMembers(supabase: SupabaseClient): Promise<Member[]> {
  const { data, error } = await supabase.rpc("household_members_overview");
  if (error) {
    throw new Error(`Could not list members: ${error.message}`);
  }
  return (data ?? []) as Member[];
}

export async function listRoles(supabase: SupabaseClient): Promise<Role[]> {
  const { data, error } = await supabase
    .from("roles")
    .select("id, name")
    .order("name");
  if (error) {
    throw new Error(`Could not list roles: ${error.message}`);
  }
  return (data ?? []) as Role[];
}
