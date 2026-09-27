"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cleanName, NAME_MAX } from "../../lib/auth/names";
import { createClient } from "../../lib/supabase/server";

export type NameState = { error?: string; saved?: boolean };

// REQ-124: setting your own name from Profile. Anyone signed in can change
// their own, and only their own: updateUser always acts on whoever is
// signed in. The name lives on the account (user_metadata), which is where
// every screen already reads it from.
export async function saveMyName(_previous: NameState, formData: FormData): Promise<NameState> {
  const name = cleanName(formData.get("name"));
  if (!name) return { error: `Type a name, up to ${NAME_MAX} characters.` };
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/sign-in");
  const { error } = await supabase.auth.updateUser({ data: { name } });
  if (error) return { error: error.message };
  // Pages read the name from the sign-in token, which still holds the old
  // one; a fresh token carries the new name from the next page on.
  await supabase.auth.refreshSession();
  revalidatePath("/", "layout");
  return { saved: true };
}
