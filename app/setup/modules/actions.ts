"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SWITCHES } from "../../../lib/modules";
import { createClient } from "../../../lib/supabase/server";

export type ChooseState = { error?: string };

// REQ-142: the new household's one choice of modules. Every switch whose
// box was left unticked starts off; nothing is written for it. The
// database checks it's the admin, and that it hasn't been done already.
export async function chooseModules(_previous: ChooseState, formData: FormData): Promise<ChooseState> {
  const kept = formData.getAll("module").map(String);
  const leftOut = SWITCHES.filter((each) => !kept.includes(each.key)).map((each) => each.key);
  const supabase = await createClient();
  const { error } = await supabase.rpc("choose_modules", { left_out: leftOut });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  redirect("/");
}
