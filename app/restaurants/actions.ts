"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission } from "../../lib/auth/permissions";
import { householdToday } from "../../lib/finances/budget-year";
import { placesFromEnv, type Place } from "../../lib/restaurants/places";
import { ALREADY_SAVED, bookingUrlFrom, lookUpLink } from "../../lib/restaurants/restaurants";
import { createClient } from "../../lib/supabase/server";

export type FormState = { error?: string };

// What a pasted link found: one place to confirm, or up to three to pick
// from (REQ-130). A place already saved carries its row's id, whether it's
// been tried and whether it has a booking link, so the screen says where
// it is instead of offering to add it again (REQ-90), or offers to add an
// OpenTable link to it (REQ-131).
export type FoundPlace = Place & { savedId: string | null; savedTried: boolean; savedBooking: boolean };
export type LookupState = FormState & { places?: FoundPlace[]; choose?: boolean; bookingUrl?: string };

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

// REQ-90, REQ-130, REQ-131: a Google Maps, Apple Maps or OpenTable link to
// the place it means.
export async function lookUpPlace(_previous: LookupState, formData: FormData): Promise<LookupState> {
  const supabase = await requireMember();
  const link = String(formData.get("link") ?? "").trim();
  if (link === "") return { error: "Paste a Google Maps, Apple Maps or OpenTable link." };
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
    .select("id, google_place_id, booking_url, tried_on")
    .in(
      "google_place_id",
      list.map((place) => place.placeId),
    );
  if (error) return { error: error.message };
  type Saved = { id: string; google_place_id: string; booking_url: string | null; tried_on: string | null };
  const saved = new Map(((data ?? []) as Saved[]).map((row) => [row.google_place_id, row]));
  return {
    places: list.map((place) => {
      const row = saved.get(place.placeId);
      return { ...place, savedId: row?.id ?? null, savedTried: Boolean(row?.tried_on), savedBooking: Boolean(row?.booking_url) };
    }),
    choose: found.kind === "choose",
    ...(found.bookingUrl ? { bookingUrl: found.bookingUrl } : {}),
  };
}

// REQ-90: the confirmed place goes on Want to try, with who added it and
// when (the database fills both in). Only its Google ID is kept, and the
// OpenTable link it came from as its booking link (REQ-131).
export async function addPlace(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const placeId = String(formData.get("placeId") ?? "").trim();
  if (!PLACE_ID.test(placeId)) return { error: "Nothing to add." };
  const pasted = String(formData.get("bookingUrl") ?? "").trim();
  const bookingUrl = pasted === "" ? null : bookingUrlFrom(pasted);
  if (pasted !== "" && !bookingUrl) return { error: "That booking link isn't a web address." };
  const { error } = await supabase.from("restaurants").insert({ google_place_id: placeId, booking_url: bookingUrl });
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

function idFrom(formData: FormData): string | null {
  const id = String(formData.get("id") ?? "").trim();
  return UUID.test(id) ? id : null;
}

// REQ-131: an OpenTable link for a place we'd already saved without one
// becomes its booking link, instead of a second copy of the place. Only
// while it has none, so it never replaces one either of us chose.
export async function addBookingLink(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = idFrom(formData);
  const bookingUrl = bookingUrlFrom(String(formData.get("bookingUrl") ?? ""));
  if (!id || !bookingUrl) return { error: "Nothing to add." };
  const { data, error } = await supabase
    .from("restaurants")
    .update({ booking_url: bookingUrl })
    .eq("id", id)
    .is("booking_url", null)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "It already has a booking link. Change it on its page." };
  refresh();
  redirect(`/restaurants/${id}`);
}

// REQ-132: add, change or (left empty) clear where a place takes bookings.
export async function setBookingLink(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = idFrom(formData);
  if (!id) return { error: "Nothing to change." };
  const pasted = String(formData.get("bookingUrl") ?? "").trim();
  const bookingUrl = pasted === "" ? null : bookingUrlFrom(pasted);
  if (pasted !== "" && !bookingUrl) return { error: "Paste a web address that starts with https://" };
  const { error } = await supabase.from("restaurants").update({ booking_url: bookingUrl }).eq("id", id);
  if (error) return { error: error.message };
  refresh();
  redirect(`/restaurants/${id}`);
}

// REQ-133: one tap, today's date, nothing to fill in. A place already
// tried keeps its first date.
export async function markTried(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = idFrom(formData);
  if (!id) return { error: "Nothing to mark." };
  const { error } = await supabase
    .from("restaurants")
    .update({ tried_on: householdToday() })
    .eq("id", id)
    .is("tried_on", null);
  if (error) return { error: error.message };
  refresh();
  redirect(`/restaurants/${id}`);
}

// REQ-133: marked tried by mistake. Back to Want to try; the database
// clears both answers as it goes.
export async function undoTried(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = idFrom(formData);
  if (!id) return { error: "Nothing to undo." };
  const { error } = await supabase.from("restaurants").update({ tried_on: null }).eq("id", id);
  if (error) return { error: error.message };
  refresh();
  redirect(`/restaurants/${id}`);
}

// REQ-133: your own "go again?", given or changed. The database lets you
// write only your own.
export async function answerGoAgain(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = idFrom(formData);
  const answer = String(formData.get("goAgain") ?? "");
  if (!id || (answer !== "yes" && answer !== "no")) return { error: "Nothing to answer." };
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/sign-in");
  const { error } = await supabase
    .from("restaurant_answers")
    .upsert({ restaurant_id: id, user_id: userId, go_again: answer === "yes", answered_at: new Date().toISOString() }, { onConflict: "restaurant_id,user_id" });
  if (error) return { error: error.message };
  refresh();
  return {};
}
