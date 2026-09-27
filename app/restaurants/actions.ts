"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission } from "../../lib/auth/permissions";
import { placesFromEnv, type Place } from "../../lib/restaurants/places";
import { ALREADY_SAVED, lookUpLink } from "../../lib/restaurants/restaurants";
import { createClient } from "../../lib/supabase/server";

export type FormState = { error?: string };

// What a pasted link found: one place to confirm, or up to three to pick
// from (REQ-130). A place already saved carries its row's id, so the
// screen says so instead of offering to add it again (REQ-90).
export type FoundPlace = Place & { savedId: string | null };
export type LookupState = FormState & { places?: FoundPlace[]; choose?: boolean };

const UUID = /^[0-9a-f-]{36}$/i;
const PLACE_ID = /^[A-Za-z0-9_-]{10,255}$/;

async function requireMember() {
  const supabase = await createClient();
  if (!(await hasPermission(supabase, "use_modules"))) redirect("/restaurants");
  return supabase;
}

function refresh() {
  revalidatePath("/restaurants", "layout");
  // Home's count.
  revalidatePath("/");
}

// REQ-90, REQ-130: a Google or Apple Maps link to the place it means.
export async function lookUpPlace(_previous: LookupState, formData: FormData): Promise<LookupState> {
  const supabase = await requireMember();
  const link = String(formData.get("link") ?? "").trim();
  if (link === "") return { error: "Paste a Google Maps or Apple Maps link." };
  const places = placesFromEnv();
  if (!places) return { error: "Looking places up isn't set up here yet (no Google key)." };
  let found;
  try {
    found = await lookUpLink(link, places);
  } catch (error) {
    Sentry.captureException(error);
    return { error: "Google didn't answer. Try again in a moment." };
  }
  if (found.kind === "error") return { error: found.message };
  const list = found.kind === "one" ? [found.place] : found.places;
  const { data, error } = await supabase
    .from("restaurants")
    .select("id, google_place_id")
    .in(
      "google_place_id",
      list.map((place) => place.placeId),
    );
  if (error) return { error: error.message };
  const saved = new Map(((data ?? []) as { id: string; google_place_id: string }[]).map((row) => [row.google_place_id, row.id]));
  return {
    places: list.map((place) => ({ ...place, savedId: saved.get(place.placeId) ?? null })),
    choose: found.kind === "choose",
  };
}

// REQ-90: the confirmed place goes on Want to try, with who added it and
// when (the database fills both in). Only its Google ID is kept.
export async function addPlace(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const placeId = String(formData.get("placeId") ?? "").trim();
  if (!PLACE_ID.test(placeId)) return { error: "Nothing to add." };
  const { error } = await supabase.from("restaurants").insert({ google_place_id: placeId });
  // Saved by the other of us between the lookup and the tap.
  if (error?.code === "23505") return { error: ALREADY_SAVED };
  if (error) return { error: error.message };
  refresh();
  redirect("/restaurants");
}

// REQ-129: off the list, after a confirm.
export async function removePlace(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = String(formData.get("id") ?? "").trim();
  if (!UUID.test(id)) return { error: "Nothing to remove." };
  const { error } = await supabase.from("restaurants").delete().eq("id", id);
  if (error) return { error: error.message };
  refresh();
  redirect("/restaurants");
}
