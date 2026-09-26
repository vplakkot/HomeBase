"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission } from "../../lib/auth/permissions";
import type { SupabaseClient } from "@supabase/supabase-js";
import { drinkFields, readDrinks, readPeople } from "../../lib/drinks/drinks";
import { shopCheck, type ShopCheck } from "../../lib/drinks/match";
import { NOTHING_READ, noReader, type LabelReading } from "../../lib/drinks/label-reader";
import { visionReader } from "../../lib/drinks/vision";
import { LABEL_BUCKET, photoPath, thumbPath, type Side } from "../../lib/drinks/photos";
import { createClient } from "../../lib/supabase/server";

export type FormState = { error?: string; saved?: boolean };

const UUID = /^[0-9a-f-]{36}$/i;

async function requireMember() {
  const supabase = await createClient();
  if (!(await hasPermission(supabase, "use_modules"))) redirect("/drinks");
  return supabase;
}

function rowId(formData: FormData, name = "id"): string | null {
  const id = String(formData.get(name) ?? "").trim();
  return UUID.test(id) ? id : null;
}

function refresh() {
  revalidatePath("/drinks", "layout");
  // Home's count.
  revalidatePath("/");
}

// A photo sent with a form: a JPEG the browser has already shrunk
// (REQ-32), with its small copy for the list.
const MAX_UPLOAD = 1024 * 1024;

function photoFrom(formData: FormData, side: Side): { full: Blob; thumb: Blob } | null | { error: string } {
  const full = formData.get(side);
  const thumb = formData.get(`${side}_thumb`);
  if (!(full instanceof Blob) || full.size === 0) return null;
  if (!(thumb instanceof Blob) || thumb.size === 0) return { error: "The photo's small copy is missing. Try again." };
  if (full.type !== "image/jpeg" || thumb.type !== "image/jpeg") return { error: "Photos are sent as JPEG." };
  if (full.size > MAX_UPLOAD || thumb.size > MAX_UPLOAD) return { error: "That photo is too big. Try again." };
  return { full, thumb };
}

type Photos = Partial<Record<Side, { full: Blob; thumb: Blob }>>;

function photosFrom(formData: FormData): Photos | { error: string } {
  const photos: Photos = {};
  for (const side of ["front", "back"] as const) {
    const photo = photoFrom(formData, side);
    if (photo && "error" in photo) return photo;
    if (photo) photos[side] = photo;
  }
  if (photos.back && !photos.front) return { error: "Add the front label first." };
  return photos;
}

// Puts the photos in the private bucket under the drink's id and says
// where. On any failure, whatever was already uploaded is taken back.
async function upload(
  supabase: SupabaseClient,
  drinkId: string,
  photos: Photos,
): Promise<{ front_label?: string; back_label?: string } | { error: string }> {
  const bucket = supabase.storage.from(LABEL_BUCKET);
  const done: string[] = [];
  const paths: { front_label?: string; back_label?: string } = {};
  for (const side of ["front", "back"] as const) {
    const photo = photos[side];
    if (!photo) continue;
    const path = photoPath(drinkId, side);
    for (const [where, blob] of [
      [path, photo.full],
      [thumbPath(path), photo.thumb],
    ] as const) {
      const { error } = await bucket.upload(where, blob, { contentType: "image/jpeg" });
      if (error) {
        if (done.length > 0) await bucket.remove(done);
        return { error: `The photo didn't upload: ${error.message}` };
      }
      done.push(where);
    }
    paths[side === "front" ? "front_label" : "back_label"] = path;
  }
  return paths;
}

// Tidying up: the drink row is already gone or never saved, so a failure
// here can't be shown to anyone usefully. It's reported to Sentry instead,
// so leftover files don't pile up unseen.
async function removePhotos(supabase: SupabaseClient, paths: readonly (string | null)[]) {
  const all = paths.filter((path): path is string => !!path).flatMap((path) => [path, thumbPath(path)]);
  if (all.length === 0) return;
  const { error } = await supabase.storage.from(LABEL_BUCKET).remove(all);
  if (error) Sentry.captureException(new Error(`Label photos left behind: ${error.message}`), { extra: { paths: all } });
}

// REQ-37: only the name and how we got it are required. From a scan
// (REQ-28), the label photos come too and are kept with it (REQ-32). A
// new drink opens on its own page, where it can be rated straight away.
export async function addDrink(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const fields = drinkFields(formData);
  if ("error" in fields) return { error: fields.error };
  const photos = photosFrom(formData);
  if ("error" in photos) return { error: photos.error };
  const id = crypto.randomUUID();
  const paths = await upload(supabase, id, photos);
  if ("error" in paths) return { error: paths.error };
  const { error } = await supabase.from("drinks").insert({ id, ...fields, ...paths });
  if (error) {
    await removePhotos(supabase, [paths.front_label ?? null, paths.back_label ?? null]);
    return { error: error.message };
  }
  refresh();
  redirect(`/drinks/${id}`);
}

// REQ-32: a drink saved without photos (by hand, or from a menu) gets
// them later, and a bad photo can be replaced; nothing else changes. The
// old photos go once the new ones are in.
export async function setPhotos(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to add photos to." };
  const photos = photosFrom(formData);
  if ("error" in photos) return { error: photos.error };
  if (!photos.front) return { error: "Take or choose the front label." };
  const { data: before } = await supabase.from("drinks").select("front_label, back_label").eq("id", id).maybeSingle();
  // A drink removed meanwhile gets no photos, so none are left behind.
  if (!before) return { error: "That drink isn't there any more." };
  const paths = await upload(supabase, id, photos);
  if ("error" in paths) return { error: paths.error };
  const { error } = await supabase
    .from("drinks")
    .update({ front_label: paths.front_label, back_label: paths.back_label ?? null })
    .eq("id", id);
  if (error) {
    await removePhotos(supabase, [paths.front_label ?? null, paths.back_label ?? null]);
    return { error: error.message };
  }
  const old = (before ?? {}) as { front_label?: string | null; back_label?: string | null };
  await removePhotos(supabase, [old.front_label ?? null, old.back_label ?? null]);
  refresh();
  return { saved: true };
}

export type Scan = { reading: LabelReading; check: ShopCheck };

// REQ-25, REQ-26, REQ-27: the photos just taken or chosen are read
// together, by Google Vision when its key is set, and what was read is
// checked against the drinks we have (REQ-33). Nothing is saved here;
// the review screen saves (REQ-28). A reading that fails or runs too long
// opens the review screen with nothing filled in, and Sentry hears why.
export async function readLabel(formData: FormData): Promise<Scan> {
  const supabase = await requireMember();
  const photos = photosFrom(formData);
  if ("error" in photos || !photos.front) return { reading: NOTHING_READ, check: { kind: "unknown" } };
  const key = process.env.GOOGLE_VISION_API_KEY;
  const reader = key ? visionReader(key) : noReader;
  let reading: LabelReading;
  try {
    reading = await reader([photos.front.full, ...(photos.back ? [photos.back.full] : [])]);
  } catch (error) {
    Sentry.captureException(error);
    reading = NOTHING_READ;
  }
  if (!reading.found) return { reading, check: { kind: "unknown" } };
  const [{ drinks, ratings }, people] = await Promise.all([readDrinks(supabase), readPeople(supabase)]);
  return { reading, check: shopCheck(reading.fields, drinks, people, ratings) };
}

export async function updateDrink(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to change." };
  const fields = drinkFields(formData);
  if ("error" in fields) return { error: fields.error };
  // REQ-36: a drink someone has rated has been had; it can't go back to
  // the want-to-try list.
  if (fields.how === "want_to_try") {
    const { count, error: counting } = await supabase
      .from("drink_ratings")
      .select("drink_id", { count: "exact", head: true })
      .eq("drink_id", id);
    if (counting) return { error: counting.message };
    if ((count ?? 0) > 0) return { error: "It has ratings, so we've had it. Clear the ratings first." };
  }
  const { error } = await supabase.from("drinks").update(fields).eq("id", id);
  if (error) return { error: error.message };
  refresh();
  redirect(`/drinks/${id}`);
}

// Removing asks first (the form does); its ratings and photos go with it.
export async function removeDrink(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to remove." };
  const { data: before } = await supabase.from("drinks").select("front_label, back_label").eq("id", id).maybeSingle();
  const { error } = await supabase.from("drinks").delete().eq("id", id);
  if (error) return { error: error.message };
  const old = (before ?? {}) as { front_label?: string | null; back_label?: string | null };
  await removePhotos(supabase, [old.front_label ?? null, old.back_label ?? null]);
  refresh();
  redirect("/drinks");
}

// REQ-29: whole stars 1 to 5 and an optional one-line comment, for the
// person signed in only. Rating again replaces the rating, never adds a
// second one: the database keeps one row per person per drink, and this
// writes over it.
export async function rateDrink(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const drinkId = rowId(formData, "drinkId");
  if (!drinkId) return { error: "Nothing to rate." };
  const stars = Number(formData.get("stars"));
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return { error: "Choose 1 to 5 stars." };
  const comment = String(formData.get("comment") ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (comment.length > 200) return { error: "Keep the comment to one short line (200 characters)." };
  // REQ-34: yes, no, or not said.
  const answer = String(formData.get("buyAgain") ?? "");
  const buy_again = answer === "yes" ? true : answer === "no" ? false : null;
  // REQ-36: a wine we only want to try hasn't been had yet.
  const { data: drink } = await supabase.from("drinks").select("how").eq("id", drinkId).maybeSingle();
  if ((drink as { how?: string } | null)?.how === "want_to_try")
    return { error: "Change how we got it from Want to try before rating." };
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/sign-in");
  const { error } = await supabase
    .from("drink_ratings")
    .upsert(
      { drink_id: drinkId, user_id: userId, stars, comment: comment || null, buy_again },
      { onConflict: "drink_id,user_id" },
    );
  if (error) return { error: error.message };
  refresh();
  return { saved: true };
}

// A rating given by mistake can be taken back (never locked). Only your
// own: the database refuses anyone else's.
export async function clearRating(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const drinkId = rowId(formData, "drinkId");
  if (!drinkId) return { error: "Nothing to clear." };
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/sign-in");
  const { error } = await supabase.from("drink_ratings").delete().eq("drink_id", drinkId).eq("user_id", userId);
  if (error) return { error: error.message };
  refresh();
  return { saved: true };
}
