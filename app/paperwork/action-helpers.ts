import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission } from "../../lib/auth/permissions";
import { createClient } from "../../lib/supabase/server";

// What Paperwork's server actions share: who may act, and reading a form.
// Not a "use server" file, so these are plain helpers, not actions.

export const UUID = /^[0-9a-f-]{36}$/i;

export async function requireMember() {
  const supabase = await createClient();
  if (!(await hasPermission(supabase, "use_modules"))) redirect("/paperwork");
  return supabase;
}

// REQ-88: only the admin changes categories (and connects Drive).
export async function requireAdmin() {
  const supabase = await createClient();
  if (!(await hasPermission(supabase, "manage_paperwork"))) redirect("/paperwork");
  return supabase;
}

export const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

// The row a form is about. A missing or garbled id would change nothing
// and still say "saved", so it's refused instead.
export function rowId(formData: FormData): string | null {
  const id = text(formData, "id");
  return UUID.test(id) ? id : null;
}

export function refresh() {
  revalidatePath("/paperwork", "layout");
  // Home's unfiled count.
  revalidatePath("/");
}
