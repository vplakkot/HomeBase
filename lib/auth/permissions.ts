import type { SupabaseClient } from "@supabase/supabase-js";

export type Permission = "use_modules" | "manage_members" | "manage_roles";

export async function hasPermission(
  supabase: SupabaseClient,
  permission: Permission,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("has_permission", { permission });
  if (error) {
    throw new Error(
      `Could not check permission "${permission}": ${error.message}`,
    );
  }
  return data === true;
}
