import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cuisineFromName } from "./gemini";
import { readCuisines } from "./recipes";

// Capitals and extra spaces don't make a different recipe (REQ-180).
export function sameName(one: string, other: string): boolean {
  const plain = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
  return plain(one) === plain(other);
}

// The recipe already called this, hidden ones too, or null.
export async function findByName(supabase: SupabaseClient, name: string): Promise<{ id: string; name: string } | null> {
  const { data, error } = await supabase.from("recipes").select("id, name");
  if (error) throw new Error(`Could not read recipes: ${error.message}`);
  return ((data ?? []) as { id: string; name: string }[]).find((recipe) => sameName(recipe.name, name)) ?? null;
}

// REQ-174, REQ-180: a card with only its name, which is "Recipe missing"
// until someone fills it in. Gemini is asked for a cuisine from the name
// alone and the card is saved without one if it isn't sure or doesn't answer.
export async function createNameOnly(
  supabase: SupabaseClient,
  name: string,
  extra: { video_url?: string | null; page_url?: string | null } = {},
): Promise<{ id: string } | { error: string }> {
  const known = await readCuisines(supabase).catch(() => [] as string[]);
  const cuisine = await cuisineFromName(name, known).catch((error: unknown) => {
    Sentry.captureException(error);
    return null;
  });
  const id = crypto.randomUUID();
  const { error } = await supabase.from("recipes").insert({ id, name, cuisine, video_url: extra.video_url ?? null, page_url: extra.page_url ?? null });
  if (error) {
    Sentry.captureException(new Error(error.message));
    return { error: "The card couldn't be saved. Try again." };
  }
  return { id };
}
