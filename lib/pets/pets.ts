import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModuleStatus } from "../module-status";

// Pets (REQ-186 to REQ-189): a profile for each pet, its vaccines, its
// diet, and the medications and preventives given at home. Dates are
// calendar days written "2026-10-08"; "today" is always passed in (the
// household's today), never read from the clock here.

// Pet photos live in a private Storage bucket; a pet row keeps the path.
export const PET_BUCKET = "pet-photos";

// "p1/1759000000000.jpg", a new name each time so a replaced photo never
// shows an old cached one.
export const petPhotoPath = (petId: string, now = Date.now()) => `${petId}/${now}.jpg`;

export type Pet = {
  id: string;
  name: string;
  nickname: string | null;
  species: string;
  photo_path: string | null;
  archived_at: string | null;
  created_at: string;
};

export type Vaccine = {
  id: string;
  pet_id: string;
  name: string;
  given_on: string;
  next_due_on: string;
  clinic: string | null;
  notes: string | null;
  created_at: string;
};

export type DietKind = "commercial" | "prescription" | "home_cooked";

export type Diet = {
  id: string;
  pet_id: string;
  kind: DietKind;
  brand: string | null;
  product: string | null;
  purpose: string | null;
  protein: string | null;
  batch_prep_on: string | null;
  grams_per_meal: number;
  meals_per_day: number;
  notes: string | null;
  started_on: string;
  ended_on: string | null;
};

export type Frequency = "daily" | "monthly" | "every_n_days";

export type Medication = {
  id: string;
  name: string;
  purpose: string | null;
  dose: string | null;
  frequency: Frequency;
  every_n_days: number | null;
  starts_on: string;
  ends_on: string | null;
  prescribing_vet: string | null;
  doses_on_hand: number | null;
  doses_per_delivery: number | null;
  delivery_interval_months: number | null;
  last_delivery_on: string | null;
  lead_time_days: number | null;
};

// Which pet takes a medication, and when that pet's next dose is.
export type MedicationPet = { medication_id: string; pet_id: string; next_dose_on: string | null };

export type Dose = {
  id: string;
  medication_id: string;
  pet_id: string;
  given_on: string;
  given_by: string | null;
  previous_next_dose_on: string | null;
  created_at: string;
};

// ---- Dates -----------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;

function parse(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function format(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return format(new Date(parse(date).getTime() + days * DAY));
}

// A calendar month on, staying within the month: 31 January + 1 month is
// 28 (or 29) February, not early March.
export function addMonths(date: string, months: number): string {
  const start = parse(date);
  const first = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return format(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(start.getUTCDate(), last))));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "5 Oct 2026": records go back years, so a day carries its year.
export function dateText(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / DAY);
}

// ---- Profiles (REQ-186) ----------------------------------------------

export const active = (pets: readonly Pet[]) => pets.filter((pet) => pet.archived_at === null);
export const archived = (pets: readonly Pet[]) => pets.filter((pet) => pet.archived_at !== null);

// The name on the card: "Biscuit", and the nickname beside it if it has one.
export function petTitle(pet: Pick<Pet, "name" | "nickname">): string {
  return pet.nickname ? `${pet.name} “${pet.nickname}”` : pet.name;
}

// ---- Vaccines (REQ-187) ----------------------------------------------

// A vaccine becomes "due soon" this many days before it is due.
export const DUE_SOON_DAYS = 30;

export type VaccineStatus = "current" | "due soon" | "overdue";

export function vaccineStatus(nextDueOn: string, today: string): VaccineStatus {
  const days = daysBetween(today, nextDueOn);
  if (days < 0) return "overdue";
  return days <= DUE_SOON_DAYS ? "due soon" : "current";
}

const sameVaccine = (name: string) => name.trim().toLowerCase();

// Newest first: the day it was given, and when two were logged for the
// same day, the one logged last.
function newestFirst(a: Vaccine, b: Vaccine): number {
  return b.given_on.localeCompare(a.given_on) || b.created_at.localeCompare(a.created_at);
}

// A vaccine's name is the same however it's capitalised or spaced.
export type VaccineHistory = { name: string; latest: Vaccine; entries: Vaccine[]; status: VaccineStatus };

// One pet's vaccines: for each, its latest entry with the status, and
// every entry newest first. Most urgent first (overdue, then due soonest).
export function vaccineHistories(vaccines: readonly Vaccine[], petId: string, today: string): VaccineHistory[] {
  const groups = new Map<string, Vaccine[]>();
  for (const vaccine of vaccines.filter((row) => row.pet_id === petId)) {
    const key = sameVaccine(vaccine.name);
    groups.set(key, [...(groups.get(key) ?? []), vaccine]);
  }
  return [...groups.values()]
    .map((group) => {
      const entries = [...group].sort(newestFirst);
      const latest = entries[0];
      return { name: latest.name, latest, entries, status: vaccineStatus(latest.next_due_on, today) };
    })
    .sort((a, b) => a.latest.next_due_on.localeCompare(b.latest.next_due_on) || a.name.localeCompare(b.name));
}

// ---- Diet (REQ-188) ---------------------------------------------------

export const currentDiet = (diets: readonly Diet[], petId: string): Diet | null =>
  diets.find((diet) => diet.pet_id === petId && diet.ended_on === null) ?? null;

// Past and current entries, newest first.
export const dietHistory = (diets: readonly Diet[], petId: string): Diet[] =>
  diets
    .filter((diet) => diet.pet_id === petId)
    .sort((a, b) => b.started_on.localeCompare(a.started_on) || (a.ended_on === null ? -1 : 1));

export const DIET_KINDS: readonly { value: DietKind; label: string }[] = [
  { value: "commercial", label: "Commercial" },
  { value: "prescription", label: "Prescription" },
  { value: "home_cooked", label: "Home-cooked" },
];

export function gramsText(grams: number): string {
  return `${Number.isInteger(grams) ? grams : grams.toFixed(1)} g`;
}

// What the food is called: brand and product, or the protein.
export function foodName(diet: Pick<Diet, "kind" | "brand" | "product" | "protein">): string {
  if (diet.kind === "home_cooked") return `Home-cooked ${diet.protein ?? ""}`.trim();
  return [diet.brand, diet.product].filter(Boolean).join(" ");
}

// The pet card's line: "Acme Sensitive Salmon · 120 g a meal".
export function dietLine(diet: Diet): string {
  return `${foodName(diet)} · ${gramsText(diet.grams_per_meal)} a meal`;
}

// Whether `next` is a different diet or only different notes, purpose or
// batch date: the first ends the current entry and starts another, the
// second is updated in place (REQ-188).
export function dietChanged(
  current: Pick<Diet, "kind" | "brand" | "product" | "protein" | "grams_per_meal" | "meals_per_day">,
  next: Pick<Diet, "kind" | "brand" | "product" | "protein" | "grams_per_meal" | "meals_per_day">,
): boolean {
  const same = (a: string | null, b: string | null) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
  return (
    current.kind !== next.kind ||
    !same(current.brand, next.brand) ||
    !same(current.product, next.product) ||
    !same(current.protein, next.protein) ||
    Number(current.grams_per_meal) !== Number(next.grams_per_meal) ||
    current.meals_per_day !== next.meals_per_day
  );
}

// ---- Medications and supply (REQ-189) ---------------------------------

export const FREQUENCIES: readonly { value: Frequency; label: string }[] = [
  { value: "daily", label: "Every day" },
  { value: "monthly", label: "Every month" },
  { value: "every_n_days", label: "Every N days" },
];

export function frequencyText(med: Pick<Medication, "frequency" | "every_n_days">): string {
  if (med.frequency === "daily") return "Every day";
  if (med.frequency === "monthly") return "Every month";
  return med.every_n_days === 1 ? "Every day" : `Every ${med.every_n_days} days`;
}

// The day after `date` that the next dose falls on: a day, a calendar
// month, or N days on.
export function nextDoseAfter(med: Pick<Medication, "frequency" | "every_n_days">, date: string): string {
  if (med.frequency === "monthly") return addMonths(date, 1);
  return addDays(date, med.frequency === "daily" ? 1 : (med.every_n_days ?? 1));
}

// Mark given moves the next dose forward by one interval from when it was
// due. A dose given late counts from today instead, so one tap after a
// missed month doesn't leave it overdue again; a course ends when the
// next dose would fall after its end date.
export function afterMarkGiven(
  med: Pick<Medication, "frequency" | "every_n_days" | "ends_on">,
  nextDoseOn: string | null,
  today: string,
): string | null {
  const from = nextDoseOn && nextDoseOn >= today ? nextDoseOn : today;
  const next = nextDoseAfter(med, from);
  return med.ends_on !== null && next > med.ends_on ? null : next;
}

// A month is 30 days for supply sums.
const MONTH_DAYS = 30;

// Doses one pet takes in a month.
export function dosesPerPetPerMonth(med: Pick<Medication, "frequency" | "every_n_days">): number {
  if (med.frequency === "daily") return MONTH_DAYS;
  if (med.frequency === "monthly") return 1;
  return MONTH_DAYS / (med.every_n_days ?? 1);
}

export type Supply = {
  onHand: number;
  // Doses a month across every pet that takes it.
  monthlyUse: number;
  runOutOn: string;
  orderByOn: string | null;
  nextDeliveryOn: string | null;
  // The run-out date is before the next delivery arrives.
  gap: boolean;
};

// REQ-189: monthly use is doses per pet per month times the pets on it;
// the run-out date is today plus doses on hand divided by monthly use; the
// order-by date is that minus the order lead time; the next delivery is
// the last one plus the delivery interval; and a gap is running out
// before it. Nothing is worked out without doses on hand, and an ended
// course needs no supply.
export function supplyOf(med: Medication, petCount: number, today: string): Supply | null {
  if (med.doses_on_hand === null || petCount === 0) return null;
  if (med.ends_on !== null && med.ends_on < today) return null;
  const monthlyUse = dosesPerPetPerMonth(med) * petCount;
  const runOutOn = addDays(today, Math.floor((med.doses_on_hand / monthlyUse) * MONTH_DAYS));
  const orderByOn = med.lead_time_days === null ? null : addDays(runOutOn, -med.lead_time_days);
  const nextDeliveryOn =
    med.last_delivery_on && med.delivery_interval_months
      ? addMonths(med.last_delivery_on, med.delivery_interval_months)
      : null;
  return {
    onHand: med.doses_on_hand,
    monthlyUse,
    runOutOn,
    orderByOn,
    nextDeliveryOn,
    gap: nextDeliveryOn !== null && runOutOn < nextDeliveryOn,
  };
}

// Mark delivery received: doses on hand go up by a delivery's worth and
// the last delivery is today.
export function afterDelivery(med: Pick<Medication, "doses_on_hand" | "doses_per_delivery">, today: string) {
  return { doses_on_hand: (med.doses_on_hand ?? 0) + (med.doses_per_delivery ?? 0), last_delivery_on: today };
}

// A medication's card on a pet's profile.
export type PetMedication = {
  medication: Medication;
  link: MedicationPet;
  // Every pet that takes it, this one included.
  petIds: string[];
  supply: Supply | null;
};

// The medications one pet takes, ongoing and due soonest first, ended
// courses last.
export function medicationsFor(
  petId: string,
  medications: readonly Medication[],
  links: readonly MedicationPet[],
  pets: readonly Pet[],
  today: string,
): PetMedication[] {
  const activeIds = new Set(active(pets).map((pet) => pet.id));
  return links
    .filter((link) => link.pet_id === petId)
    .flatMap((link) => {
      const medication = medications.find((row) => row.id === link.medication_id);
      if (!medication) return [];
      const petIds = links.filter((other) => other.medication_id === medication.id).map((other) => other.pet_id);
      // Pets that are archived no longer use any (REQ-186 hides them).
      const using = petIds.filter((id) => activeIds.has(id)).length;
      return [{ medication, link, petIds, supply: supplyOf(medication, using, today) }];
    })
    .sort((a, b) => {
      const ended = (m: PetMedication) => (m.link.next_dose_on === null ? 1 : 0);
      return ended(a) - ended(b) || (a.link.next_dose_on ?? "").localeCompare(b.link.next_dose_on ?? "");
    });
}

// ---- Reading ------------------------------------------------------------

export type PetsData = {
  pets: Pet[];
  vaccines: Vaccine[];
  diets: Diet[];
  medications: Medication[];
  links: MedicationPet[];
  doses: Dose[];
};

async function rows<T>(supabase: SupabaseClient, table: string, columns: string, order?: string): Promise<T[]> {
  const query = supabase.from(table).select(columns);
  const { data, error } = await (order ? query.order(order) : query);
  if (error) throw new Error(`Could not read ${table}: ${error.message}`);
  return (data ?? []) as T[];
}

export async function readPets(supabase: SupabaseClient): Promise<PetsData> {
  const [pets, vaccines, diets, medications, links, doses] = await Promise.all([
    rows<Pet>(supabase, "pets", "id, name, nickname, species, photo_path, archived_at, created_at", "created_at"),
    rows<Vaccine>(supabase, "pet_vaccines", "id, pet_id, name, given_on, next_due_on, clinic, notes, created_at"),
    rows<Diet>(
      supabase,
      "pet_diets",
      "id, pet_id, kind, brand, product, purpose, protein, batch_prep_on, grams_per_meal, meals_per_day, notes, started_on, ended_on",
    ),
    rows<Medication>(
      supabase,
      "pet_medications",
      "id, name, purpose, dose, frequency, every_n_days, starts_on, ends_on, prescribing_vet, doses_on_hand, doses_per_delivery, delivery_interval_months, last_delivery_on, lead_time_days",
      "created_at",
    ),
    rows<MedicationPet>(supabase, "pet_medication_pets", "medication_id, pet_id, next_dose_on"),
    rows<Dose>(supabase, "pet_doses", "id, medication_id, pet_id, given_on, given_by, previous_next_dose_on, created_at"),
  ]);
  return {
    pets,
    // numeric columns can arrive as strings
    diets: diets.map((diet) => ({ ...diet, grams_per_meal: Number(diet.grams_per_meal) })),
    vaccines,
    medications,
    links,
    doses,
  };
}

// Home's count, without reading the rest.
export async function countPets(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from("pets")
    .select("id", { count: "exact", head: true })
    .is("archived_at", null);
  if (error) throw new Error(`Could not count Pets: ${error.message}`);
  return count ?? 0;
}

// Home's tile. Notifications are a separate requirement, so for now it
// only says how many pets there are.
export function petsTile(count: number): ModuleStatus {
  const status = count === 0 ? "No pets yet" : count === 1 ? "1 pet" : `${count} pets`;
  return { status, headline: status, facts: [], actionItems: [] };
}
