"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cleanName, NAME_MAX } from "../../lib/auth/names";
import { MODULES } from "../../lib/modules";
import { createClient } from "../../lib/supabase/server";

export type NameState = { error?: string; saved?: boolean };
export type HiddenState = { error?: string; hidden?: boolean };

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

// REQ-143: hide a module from your own navigation and Home cards, or show
// it again. Only ever your own: the row carries your ID, and nobody else
// can read or change it. The form sends the state it wants.
export async function setModuleHidden(_previous: HiddenState, formData: FormData): Promise<HiddenState> {
  const slug = String(formData.get("module") ?? "");
  if (!MODULES.some((module) => module.slug === slug)) return { error: "Which module?" };
  const hidden = formData.get("hidden") === "true";
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/sign-in");
  const { error } = hidden
    ? await supabase
        .from("modules_hidden")
        .upsert({ user_id: data.claims.sub, module: slug }, { onConflict: "user_id,module", ignoreDuplicates: true })
    : await supabase.from("modules_hidden").delete().eq("user_id", data.claims.sub).eq("module", slug);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { hidden };
}
