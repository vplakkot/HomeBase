import type { SupabaseClient } from "@supabase/supabase-js";
import { EVERYTHING_ON, modulesUnder, type ModuleView } from "./modules";

// Reading which modules are off for the household (REQ-141) and hidden by
// this person (REQ-143). If either can't be read, everything counts as on
// and shown: a missing switch must never take the app down with it.
export async function readModuleView(supabase: SupabaseClient, userId: string): Promise<ModuleView> {
  const [off, hidden] = await Promise.all([
    supabase.from("modules_off").select("module"),
    supabase.from("modules_hidden").select("module").eq("user_id", userId),
  ]);
  if (off.error || hidden.error) {
    console.error("Could not read the module switches", (off.error ?? hidden.error)?.message);
    return EVERYTHING_ON;
  }
  return {
    off: modulesUnder(((off.data ?? []) as { module: string }[]).map((row) => row.module)),
    hidden: ((hidden.data ?? []) as { module: string }[]).map((row) => row.module),
  };
}

// For a scheduled job, which reads as the service rather than a person:
// is this module's switch off? Unlike Home, a job that can't tell says so
// by failing, rather than sending pushes for a module that may be off.
export async function isSwitchedOff(admin: SupabaseClient, slug: string): Promise<boolean> {
  const { data, error } = await admin.from("modules_off").select("module");
  if (error) throw new Error(`Could not read the module switches: ${error.message}`);
  return modulesUnder(((data ?? []) as { module: string }[]).map((row) => row.module)).includes(slug);
}

// REQ-142: whether the household's admin has chosen its modules yet.
// Unreadable counts as chosen, so nobody is sent to the step by mistake.
export async function modulesChosen(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.from("households").select("modules_chosen").maybeSingle();
  if (error || !data) return true;
  return (data as { modules_chosen: boolean }).modules_chosen !== false;
}
