import {
  addDays,
  foodName,
  gramsText,
  medicationsFor,
  supplyOf,
  vaccineHistories,
  active,
  type Diet,
  type Frequency,
  type PetsData,
} from "./pets";

// REQ-190 and REQ-192: what each Pets notification says, and which
// date-based ones are due today. All plain functions of their input, so the
// wording and the rules are tested without sending anything.

// "Oct 20" in the current year, "Oct 2029" in another: these go in a
// sentence on a lock screen, where the year only matters when it isn't this one.
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDate(iso: string, today: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const [thisYear] = today.split("-").map(Number);
  return year === thisYear ? `${SHORT_MONTHS[month - 1]} ${day}` : `${SHORT_MONTHS[month - 1]} ${year}`;
}

// ---- Things someone just did (REQ-192) -------------------------------

export const petAdded = (name: string) => `${name} was added to Pets.`;
export const petArchived = (name: string) => `${name}'s profile was sent over the rainbow bridge.`;
export const vaccineLogged = (name: string, vaccine: string, nextDueOn: string, today: string) =>
  `${name} got ${vaccine} today. Next due ${shortDate(nextDueOn, today)}.`;

// "Livy", "Livy and Xiao Wu", "Livy, Xiao Wu and Biscuit".
export function names(list: readonly string[]): string {
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

// "monthly", "daily", "every 14 days": how often, as a word in a sentence.
export function frequencyWord(med: { frequency: Frequency; every_n_days: number | null }): string {
  return med.frequency === "every_n_days" ? `every ${med.every_n_days} days` : med.frequency;
}

export const medicationStarted = (pets: readonly string[], medication: string, frequency: string) =>
  `${names(pets)} started ${medication}, ${frequency}.`;
export const medicationStopped = (pets: readonly string[], medication: string) =>
  `${names(pets)} stopped ${medication}.`;
export const doseGiven = (person: string, pet: string, medication: string) => `${person} gave ${pet} ${medication}.`;

// ---- Diet changes (REQ-190) --------------------------------------------

type Meal = Pick<
  Diet,
  "id" | "kind" | "brand" | "product" | "protein" | "grams_per_meal" | "meals_per_day" | "batch_prep_on" | "food_runs_out_on" | "started_on"
>;

const sameFood = (a: Meal, b: Meal) =>
  foodName(a).trim().toLowerCase() === foodName(b).trim().toLowerCase() && a.kind === b.kind;
const sameAmount = (a: Meal, b: Meal) =>
  Number(a.grams_per_meal) === Number(b.grams_per_meal) && a.meals_per_day === b.meals_per_day;

// What the household is told about a pet's diet, from the diet before the
// first edit of a burst (null if there was none) and the one now. Null when
// the burst changed nothing worth telling, such as an edit undone again.
export function dietMessage(pet: string, before: Meal | null, after: Meal, today: string): string | null {
  const food = foodName(after);
  const grams = gramsText(Number(after.grams_per_meal));
  // Said only when this change touched it, or it is the first diet's.
  const since = after.started_on < today ? ` Since ${shortDate(after.started_on, today)}.` : "";

  if (before === null) return `${pet} meal set: ${food}, ${grams} per meal.${since}`;

  // A new batch of the same food at the same amount.
  if (sameFood(before, after) && sameAmount(before, after)) {
    const isNewBatch =
      after.kind === "home_cooked" &&
      before.id !== after.id &&
      (before.food_runs_out_on !== after.food_runs_out_on || before.batch_prep_on !== after.batch_prep_on);
    if (!isNewBatch) return null;
    const runsOut = after.food_runs_out_on ? ` Runs out ${shortDate(after.food_runs_out_on, today)}.` : "";
    return `${pet} new batch: ${food.replace(/^Home-cooked /, "")}, ${grams} per meal.${runsOut}${since}`;
  }

  // Meals a day are named only when they changed; for a home-cooked diet
  // the food is the protein alone.
  const named = after.kind === "home_cooked" ? food.replace(/^Home-cooked /, "") : food;
  const meals = before.meals_per_day !== after.meals_per_day ? `, ${after.meals_per_day} meals a day` : "";
  return `${pet} meal updated: ${named}, ${grams} per meal${meals}.${since}`;
}

// ---- Reminders for a date (REQ-192) --------------------------------------

export type Reminder = { topic: string; body: string; url: string };

// Every date-based reminder due today. Each fires on exactly its day and is
// claimed by its topic, so the five-minute job can't send one twice. Only
// active pets are reminded about.
export function remindersDue(data: PetsData, today: string): Reminder[] {
  const out: Reminder[] = [];
  const pets = active(data.pets);
  for (const pet of pets) {
    const url = `/pets/${pet.id}`;

    for (const history of vaccineHistories(data.vaccines, pet.id, today)) {
      const { latest } = history;
      if (addDays(today, 30) === latest.next_due_on) {
        out.push({ topic: `vaccine-soon:${latest.id}`, body: `${pet.name}'s ${latest.name} is due ${shortDate(latest.next_due_on, today)}.`, url });
      }
      if (addDays(latest.next_due_on, 1) === today) {
        out.push({
          topic: `vaccine-overdue:${latest.id}`,
          body: `${pet.name}'s ${latest.name} is overdue (was due ${shortDate(latest.next_due_on, today)}).`,
          url,
        });
      }
    }

    for (const { medication, link } of medicationsFor(pet.id, data.medications, data.links, data.pets, today)) {
      const due = link.next_dose_on;
      if (due === null) continue;
      if (due === today) {
        out.push({ topic: `dose-due:${medication.id}:${pet.id}:${due}`, body: `${pet.name}'s ${medication.name} is due today.`, url });
      }
      if (addDays(due, 2) === today) {
        out.push({ topic: `dose-late:${medication.id}:${pet.id}:${due}`, body: `${pet.name}'s ${medication.name} is 2 days overdue.`, url });
      }
    }

    const diet = data.diets.find((row) => row.pet_id === pet.id && row.ended_on === null);
    if (diet?.food_runs_out_on && addDays(today, 1) === diet.food_runs_out_on) {
      out.push({
        topic: `food-out:${diet.id}`,
        body: `${pet.name}'s food runs out tomorrow (${shortDate(diet.food_runs_out_on, today)}).`,
        url,
      });
    }
  }

  // Order-by reminders are about a product, not one pet, so they go once.
  const activeIds = new Set(pets.map((pet) => pet.id));
  for (const medication of data.medications) {
    const using = data.links.filter((link) => link.medication_id === medication.id && activeIds.has(link.pet_id)).length;
    const supply = supplyOf(medication, using, today);
    if (!supply || supply.orderByOn === null || supply.orderByOn > today) continue;
    out.push({
      // Once for each stretch between deliveries: marking one received starts a new one.
      topic: `order-by:${medication.id}:${medication.last_delivery_on ?? "start"}`,
      body: `Order ${medication.name} by ${shortDate(supply.orderByOn, today)}. Supply runs out ${shortDate(supply.runOutOn, today)}.`,
      url: "/pets",
    });
  }
  return out;
}
