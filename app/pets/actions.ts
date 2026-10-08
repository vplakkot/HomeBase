"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission } from "../../lib/auth/permissions";
import { thumbPath } from "../../lib/drinks/photos";
import { householdToday } from "../../lib/finances/budget-year";
import {
  PET_BUCKET,
  afterDelivery,
  afterMarkGiven,
  dietChanged,
  petPhotoPath,
  type Diet,
  type DietKind,
  type Frequency,
  type Medication,
} from "../../lib/pets/pets";
import { createClient } from "../../lib/supabase/server";

export type FormState = { error?: string; saved?: boolean };

const UUID = /^[0-9a-f-]{36}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_UPLOAD = 1_000_000;

async function requireMember() {
  const supabase = await createClient();
  if (!(await hasPermission(supabase, "use_modules"))) redirect("/pets");
  return supabase;
}

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();
const optional = (formData: FormData, name: string) => text(formData, name) || null;

function rowId(formData: FormData, name = "id"): string | null {
  const id = text(formData, name);
  return UUID.test(id) ? id : null;
}

function dateOf(formData: FormData, name: string): string | null | "bad" {
  const value = text(formData, name);
  if (value === "") return null;
  if (!DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return "bad";
  return value;
}

// A whole number of at least `min`, or null when the field is empty.
function whole(formData: FormData, name: string, min: number): number | null | "bad" {
  const value = text(formData, name);
  if (value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= min ? number : "bad";
}

function refresh() {
  revalidatePath("/pets", "layout");
  // Home's count.
  revalidatePath("/");
}

// ---- Profiles (REQ-186) ------------------------------------------------

type Photo = { full: Blob; thumb: Blob };

function photoFrom(formData: FormData): Photo | null | { error: string } {
  const full = formData.get("photo");
  if (!(full instanceof Blob) || full.size === 0) return null;
  const thumb = formData.get("photo_thumb");
  if (!(thumb instanceof Blob) || thumb.size === 0) return { error: "The photo's small copy is missing. Try again." };
  if (full.type !== "image/jpeg" || thumb.type !== "image/jpeg") return { error: "Photos are sent as JPEG." };
  if (full.size > MAX_UPLOAD || thumb.size > MAX_UPLOAD) return { error: "That photo is too big. Try again." };
  return { full, thumb };
}

async function uploadPhoto(supabase: SupabaseClient, petId: string, photo: Photo): Promise<{ path: string } | { error: string }> {
  const path = petPhotoPath(petId);
  const bucket = supabase.storage.from(PET_BUCKET);
  for (const [where, blob] of [
    [path, photo.full],
    [thumbPath(path), photo.thumb],
  ] as const) {
    const { error } = await bucket.upload(where, blob, { contentType: "image/jpeg" });
    if (error) {
      await bucket.remove([path, thumbPath(path)]);
      return { error: `The photo didn't upload: ${error.message}` };
    }
  }
  return { path };
}

async function removePhotos(supabase: SupabaseClient, path: string | null | undefined) {
  if (!path) return;
  await supabase.storage.from(PET_BUCKET).remove([path, thumbPath(path)]);
}

function petFields(formData: FormData) {
  const name = text(formData, "name");
  if (name === "") return { error: "Give the pet a name." };
  const species = text(formData, "species");
  if (species === "") return { error: "Say what kind of pet it is." };
  return { name, nickname: optional(formData, "nickname"), species };
}

// REQ-186: a pet with a name, nickname, species and photo. The photo goes
// up first under the new pet's ID; if the row then fails, it's taken back.
export async function addPet(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const fields = petFields(formData);
  if ("error" in fields) return { error: fields.error };
  const photo = photoFrom(formData);
  if (photo && "error" in photo) return { error: photo.error };
  const id = crypto.randomUUID();
  let photo_path: string | null = null;
  if (photo) {
    const uploaded = await uploadPhoto(supabase, id, photo);
    if ("error" in uploaded) return { error: uploaded.error };
    photo_path = uploaded.path;
  }
  const { error } = await supabase.from("pets").insert({ id, ...fields, photo_path });
  if (error) {
    await removePhotos(supabase, photo_path);
    return { error: error.message };
  }
  refresh();
  return { saved: true };
}

// REQ-186: change any detail; a new photo replaces the old, or "remove"
// takes it away.
export async function updatePet(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to change." };
  const fields = petFields(formData);
  if ("error" in fields) return { error: fields.error };
  const photo = photoFrom(formData);
  if (photo && "error" in photo) return { error: photo.error };
  const { data: before } = await supabase.from("pets").select("photo_path").eq("id", id).maybeSingle();
  const oldPath = (before as { photo_path: string | null } | null)?.photo_path ?? null;
  let photo_path: string | null | undefined;
  if (photo) {
    const uploaded = await uploadPhoto(supabase, id, photo);
    if ("error" in uploaded) return { error: uploaded.error };
    photo_path = uploaded.path;
  } else if (formData.get("removePhoto") === "yes") {
    photo_path = null;
  }
  const { error } = await supabase
    .from("pets")
    .update({ ...fields, ...(photo_path === undefined ? {} : { photo_path }) })
    .eq("id", id);
  if (error) {
    if (photo_path) await removePhotos(supabase, photo_path);
    return { error: error.message };
  }
  if (photo_path !== undefined) await removePhotos(supabase, oldPath);
  refresh();
  return { saved: true };
}

// REQ-186: archiving hides the pet and keeps every record; restoring
// brings it back.
export async function archivePet(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to archive." };
  const { error } = await supabase.from("pets").update({ archived_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: error.message };
  refresh();
  redirect("/pets");
}

export async function restorePet(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to restore." };
  const { error } = await supabase.from("pets").update({ archived_at: null }).eq("id", id);
  if (error) return { error: error.message };
  refresh();
  redirect(`/pets/${id}`);
}

// A profile added by mistake can go for good, once it's archived; the
// form asks first. Its records go with it.
export async function removePet(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to remove." };
  const { data } = await supabase.from("pets").select("photo_path, archived_at").eq("id", id).maybeSingle();
  const pet = data as { photo_path: string | null; archived_at: string | null } | null;
  if (!pet) return { error: "That pet is already gone." };
  if (pet.archived_at === null) return { error: "Archive the pet first." };
  const { error } = await supabase.from("pets").delete().eq("id", id);
  if (error) return { error: error.message };
  await removePhotos(supabase, pet.photo_path);
  refresh();
  redirect("/pets/archived");
}

// ---- Vaccines (REQ-187) --------------------------------------------------

function vaccineFields(formData: FormData) {
  const name = text(formData, "name");
  if (name === "") return { error: "Name the vaccine." };
  const given_on = dateOf(formData, "givenOn");
  if (given_on === null || given_on === "bad") return { error: "Say the date it was given." };
  const next_due_on = dateOf(formData, "nextDueOn");
  if (next_due_on === null || next_due_on === "bad") return { error: "Say when the next one is due." };
  if (next_due_on < given_on) return { error: "The next due date can't be before the date it was given." };
  return { name, given_on, next_due_on, clinic: optional(formData, "clinic"), notes: optional(formData, "notes") };
}

// REQ-187: a dose of a vaccine, with the next due date as typed. An
// earlier entry for the same vaccine stays as history.
export async function addVaccine(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const petId = rowId(formData, "petId");
  if (!petId) return { error: "Nothing to add to." };
  const fields = vaccineFields(formData);
  if ("error" in fields) return { error: fields.error };
  const { error } = await supabase.from("pet_vaccines").insert({ pet_id: petId, ...fields });
  if (error) return { error: error.message };
  refresh();
  return { saved: true };
}

export async function updateVaccine(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to change." };
  const fields = vaccineFields(formData);
  if ("error" in fields) return { error: fields.error };
  const { error } = await supabase.from("pet_vaccines").update(fields).eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { saved: true };
}

export async function removeVaccine(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to remove." };
  const { error } = await supabase.from("pet_vaccines").delete().eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { saved: true };
}

// ---- Diet (REQ-188) -------------------------------------------------------

const KINDS: readonly DietKind[] = ["commercial", "prescription", "home_cooked"];

function dietFields(formData: FormData) {
  const kind = text(formData, "kind") as DietKind;
  if (!KINDS.includes(kind)) return { error: "Choose a type of diet." };
  const grams = Number(text(formData, "grams"));
  if (!(grams > 0) || grams > 99999) return { error: "Say how many grams a meal." };
  const meals = whole(formData, "meals", 1);
  if (meals === null || meals === "bad") return { error: "Say how many meals a day." };
  const notes = optional(formData, "notes");
  if (kind === "home_cooked") {
    const protein = text(formData, "protein");
    if (protein === "") return { error: "Say the protein, for example chicken." };
    const batch = dateOf(formData, "batchPrepOn");
    if (batch === "bad") return { error: "That batch prep date isn't a date." };
    return {
      kind,
      brand: null,
      product: null,
      purpose: null,
      protein,
      batch_prep_on: batch,
      grams_per_meal: grams,
      meals_per_day: meals,
      notes,
    };
  }
  const brand = text(formData, "brand");
  const product = text(formData, "product");
  if (brand === "" || product === "") return { error: "Give the brand and the product." };
  return {
    kind,
    brand,
    product,
    purpose: optional(formData, "purpose"),
    protein: null,
    batch_prep_on: null,
    grams_per_meal: grams,
    meals_per_day: meals,
    notes,
  };
}

// REQ-188: set or change a pet's diet. Changing the type, food, protein,
// grams or meals ends the current entry (today) and starts another, so
// the history is kept. Changing only the notes, purpose or batch date
// updates the entry where it stands.
export async function saveDiet(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const petId = rowId(formData, "petId");
  if (!petId) return { error: "Nothing to add to." };
  const fields = dietFields(formData);
  if ("error" in fields) return { error: fields.error };
  const { data, error: readError } = await supabase
    .from("pet_diets")
    .select("id, kind, brand, product, protein, grams_per_meal, meals_per_day, started_on")
    .eq("pet_id", petId)
    .is("ended_on", null)
    .maybeSingle();
  if (readError) return { error: readError.message };
  const current = data as (Pick<Diet, "id" | "kind" | "brand" | "product" | "protein" | "grams_per_meal" | "meals_per_day" | "started_on">) | null;
  const today = householdToday();
  if (current && !dietChanged({ ...current, grams_per_meal: Number(current.grams_per_meal) }, { ...fields })) {
    const { error } = await supabase
      .from("pet_diets")
      .update({ purpose: fields.purpose, batch_prep_on: fields.batch_prep_on, notes: fields.notes })
      .eq("id", current.id);
    if (error) return { error: error.message };
  } else {
    if (current) {
      const { error } = await supabase
        .from("pet_diets")
        .update({ ended_on: today < current.started_on ? current.started_on : today })
        .eq("id", current.id);
      if (error) return { error: error.message };
    }
    const { error } = await supabase.from("pet_diets").insert({ pet_id: petId, ...fields, started_on: today });
    if (error) return { error: error.message };
  }
  refresh();
  return { saved: true };
}

export async function removeDiet(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to remove." };
  const { error } = await supabase.from("pet_diets").delete().eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { saved: true };
}

// ---- Medications (REQ-189) ---------------------------------------------

const FREQUENCY: readonly Frequency[] = ["daily", "monthly", "every_n_days"];

function medicationFields(formData: FormData) {
  const name = text(formData, "name");
  if (name === "") return { error: "Name the medication." };
  const frequency = text(formData, "frequency") as Frequency;
  if (!FREQUENCY.includes(frequency)) return { error: "Say how often it's given." };
  let every_n_days: number | null = null;
  if (frequency === "every_n_days") {
    const days = whole(formData, "everyNDays", 1);
    if (days === null || days === "bad") return { error: "Say how many days between doses." };
    every_n_days = days;
  }
  const starts_on = dateOf(formData, "startsOn");
  if (starts_on === null || starts_on === "bad") return { error: "Say the date it starts." };
  // "Ongoing" means no end date.
  const ongoing = formData.get("ongoing") === "yes";
  const ends = ongoing ? null : dateOf(formData, "endsOn");
  if (ends === "bad") return { error: "That end date isn't a date." };
  if (!ongoing && ends === null) return { error: "Give an end date, or tick Ongoing." };
  if (ends !== null && ends < starts_on) return { error: "It can't end before it starts." };
  const onHand = whole(formData, "dosesOnHand", 0);
  const perDelivery = whole(formData, "dosesPerDelivery", 1);
  const interval = whole(formData, "deliveryIntervalMonths", 1);
  const lead = whole(formData, "leadTimeDays", 0);
  const lastDelivery = dateOf(formData, "lastDeliveryOn");
  if ([onHand, perDelivery, interval, lead].includes("bad") || lastDelivery === "bad") {
    return { error: "The supply numbers must be whole numbers and the delivery date a date." };
  }
  return {
    name,
    purpose: optional(formData, "purpose"),
    dose: optional(formData, "dose"),
    frequency,
    every_n_days,
    starts_on,
    ends_on: ends,
    prescribing_vet: optional(formData, "prescribingVet"),
    doses_on_hand: onHand as number | null,
    doses_per_delivery: perDelivery as number | null,
    delivery_interval_months: interval as number | null,
    last_delivery_on: lastDelivery,
    lead_time_days: lead as number | null,
  };
}

function petIdsOf(formData: FormData): string[] {
  return [...new Set(formData.getAll("petIds").map(String).filter((id) => UUID.test(id)))];
}

// REQ-189: one product, linked to each pet that takes it. Each pet's
// first dose is due on the start date.
export async function addMedication(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const fields = medicationFields(formData);
  if ("error" in fields) return { error: fields.error };
  const petIds = petIdsOf(formData);
  if (petIds.length === 0) return { error: "Choose at least one pet that takes it." };
  const { data, error } = await supabase.from("pet_medications").insert(fields).select("id").single();
  if (error || !data) return { error: error?.message ?? "Could not add the medication." };
  const medicationId = (data as { id: string }).id;
  const { error: linkError } = await supabase
    .from("pet_medication_pets")
    .insert(petIds.map((pet_id) => ({ medication_id: medicationId, pet_id, next_dose_on: fields.starts_on })));
  if (linkError) {
    await supabase.from("pet_medications").delete().eq("id", medicationId);
    return { error: linkError.message };
  }
  refresh();
  return { saved: true };
}

// REQ-189: change the product or which pets take it. A pet already on it
// keeps its next dose date; one added starts on the start date; one taken
// off loses its link (its logged doses stay in the history).
export async function updateMedication(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to change." };
  const fields = medicationFields(formData);
  if ("error" in fields) return { error: fields.error };
  const petIds = petIdsOf(formData);
  if (petIds.length === 0) return { error: "Choose at least one pet that takes it." };
  const { error } = await supabase.from("pet_medications").update(fields).eq("id", id);
  if (error) return { error: error.message };
  const { data: existing, error: readError } = await supabase.from("pet_medication_pets").select("pet_id").eq("medication_id", id);
  if (readError) return { error: readError.message };
  const had = new Set(((existing ?? []) as { pet_id: string }[]).map((row) => row.pet_id));
  const added = petIds.filter((petId) => !had.has(petId));
  const dropped = [...had].filter((petId) => !petIds.includes(petId));
  if (added.length > 0) {
    const { error: addError } = await supabase
      .from("pet_medication_pets")
      .insert(added.map((pet_id) => ({ medication_id: id, pet_id, next_dose_on: fields.starts_on })));
    if (addError) return { error: addError.message };
  }
  if (dropped.length > 0) {
    const { error: dropError } = await supabase.from("pet_medication_pets").delete().eq("medication_id", id).in("pet_id", dropped);
    if (dropError) return { error: dropError.message };
  }
  refresh();
  return { saved: true };
}

export async function removeMedication(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to remove." };
  const { error } = await supabase.from("pet_medications").delete().eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { saved: true };
}

type Course = Pick<Medication, "frequency" | "every_n_days" | "ends_on" | "doses_on_hand">;

// REQ-189: Mark given logs the dose with the day and who gave it, moves
// this pet's next dose forward one interval, and takes one off the doses
// on hand (if supply is tracked, and never below none). Each write is
// guarded by what was read, so two people tapping together don't both
// count the same dose.
export async function markGiven(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const medicationId = rowId(formData, "medicationId");
  const petId = rowId(formData, "petId");
  if (!medicationId || !petId) return { error: "Nothing to mark." };
  const [{ data: medData }, { data: linkData }] = await Promise.all([
    supabase.from("pet_medications").select("frequency, every_n_days, ends_on, doses_on_hand").eq("id", medicationId).maybeSingle(),
    supabase.from("pet_medication_pets").select("next_dose_on").eq("medication_id", medicationId).eq("pet_id", petId).maybeSingle(),
  ]);
  const med = medData as Course | null;
  const link = linkData as { next_dose_on: string | null } | null;
  if (!med || !link) return { error: "That medication is no longer on this pet." };
  if (link.next_dose_on === null) return { error: "This course has ended." };
  const today = householdToday();
  const next = afterMarkGiven(med, link.next_dose_on, today);
  const moved = await supabase
    .from("pet_medication_pets")
    .update({ next_dose_on: next })
    .eq("medication_id", medicationId)
    .eq("pet_id", petId)
    .eq("next_dose_on", link.next_dose_on);
  if (moved.error) return { error: moved.error.message };
  const logged = await supabase
    .from("pet_doses")
    .insert({ medication_id: medicationId, pet_id: petId, given_on: today, previous_next_dose_on: link.next_dose_on });
  if (logged.error) return { error: logged.error.message };
  if (med.doses_on_hand !== null && med.doses_on_hand > 0) {
    const { error } = await supabase
      .from("pet_medications")
      .update({ doses_on_hand: med.doses_on_hand - 1 })
      .eq("id", medicationId)
      .eq("doses_on_hand", med.doses_on_hand);
    if (error) return { error: error.message };
  }
  refresh();
  return { saved: true };
}

// A dose marked by mistake: the latest dose for a pet can be undone, which
// puts back its next dose date and the dose on hand.
export async function undoDose(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to undo." };
  const { data } = await supabase
    .from("pet_doses")
    .select("id, medication_id, pet_id, previous_next_dose_on, created_at")
    .eq("id", id)
    .maybeSingle();
  const dose = data as { medication_id: string; pet_id: string; previous_next_dose_on: string | null; created_at: string } | null;
  if (!dose) return { error: "That dose is already gone." };
  const { data: later } = await supabase
    .from("pet_doses")
    .select("id")
    .eq("medication_id", dose.medication_id)
    .eq("pet_id", dose.pet_id)
    .gt("created_at", dose.created_at);
  if (((later ?? []) as unknown[]).length > 0) return { error: "Only the latest dose can be undone." };
  const { error } = await supabase
    .from("pet_medication_pets")
    .update({ next_dose_on: dose.previous_next_dose_on })
    .eq("medication_id", dose.medication_id)
    .eq("pet_id", dose.pet_id);
  if (error) return { error: error.message };
  const { data: medData } = await supabase.from("pet_medications").select("doses_on_hand").eq("id", dose.medication_id).maybeSingle();
  const onHand = (medData as { doses_on_hand: number | null } | null)?.doses_on_hand ?? null;
  if (onHand !== null) {
    const { error: handError } = await supabase.from("pet_medications").update({ doses_on_hand: onHand + 1 }).eq("id", dose.medication_id);
    if (handError) return { error: handError.message };
  }
  const { error: deleteError } = await supabase.from("pet_doses").delete().eq("id", id);
  if (deleteError) return { error: deleteError.message };
  refresh();
  return { saved: true };
}

// REQ-189: Mark delivery received adds a delivery's worth to the doses on
// hand and dates the last delivery today.
export async function markDelivery(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to mark." };
  const { data } = await supabase.from("pet_medications").select("doses_on_hand, doses_per_delivery").eq("id", id).maybeSingle();
  const med = data as Pick<Medication, "doses_on_hand" | "doses_per_delivery"> | null;
  if (!med) return { error: "That medication is already gone." };
  if (med.doses_per_delivery === null) return { error: "Set doses per delivery first (Edit)." };
  let update = supabase.from("pet_medications").update(afterDelivery(med, householdToday())).eq("id", id);
  update = med.doses_on_hand === null ? update.is("doses_on_hand", null) : update.eq("doses_on_hand", med.doses_on_hand);
  const { error } = await update;
  if (error) return { error: error.message };
  refresh();
  return { saved: true };
}
