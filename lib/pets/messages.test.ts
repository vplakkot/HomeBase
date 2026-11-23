import { describe, expect, it } from "vitest";
import {
  dietMessage,
  doseGiven,
  frequencyWord,
  medicationStarted,
  medicationStopped,
  names,
  petAdded,
  petArchived,
  remindersDue,
  shortDate,
  vaccineLogged,
} from "./messages";
import type { Diet, Medication, PetsData } from "./pets";

// Invented pets and records; nothing here is real.
const TODAY = "2026-10-08";

const diet = (extra: Partial<Diet> = {}): Diet => ({
  id: "d1",
  pet_id: "livy",
  kind: "prescription",
  brand: "Hill's",
  product: "i/d",
  purpose: null,
  protein: null,
  batch_prep_on: null,
  food_runs_out_on: null,
  grams_per_meal: 150,
  meals_per_day: 2,
  notes: null,
  started_on: TODAY,
  ended_on: null,
  ...extra,
});
const home = (extra: Partial<Diet> = {}) =>
  diet({ kind: "home_cooked", brand: null, product: null, protein: "chicken", grams_per_meal: 120, ...extra });

describe("words for things someone did (REQ-192)", () => {
  it("says what happened to a pet", () => {
    expect(petAdded("Livy")).toBe("Livy was added to Pets.");
    expect(petArchived("Livy")).toBe("Livy's profile was sent over the rainbow bridge.");
  });

  it("says a vaccine was given and when the next is due", () => {
    expect(vaccineLogged("Xiao Wu", "Rabies", "2029-10-08", TODAY)).toBe("Xiao Wu got Rabies today. Next due Oct 2029.");
    expect(vaccineLogged("Livy", "DHPP", "2026-11-03", TODAY)).toBe("Livy got DHPP today. Next due Nov 3.");
  });

  it("says a medication started or stopped, for one pet or several", () => {
    expect(medicationStarted(["Livy"], "Simparica Trio", "monthly")).toBe("Livy started Simparica Trio, monthly.");
    expect(medicationStopped(["Livy"], "Simparica Trio")).toBe("Livy stopped Simparica Trio.");
    expect(names(["Livy", "Xiao Wu", "Biscuit"])).toBe("Livy, Xiao Wu and Biscuit");
    expect(frequencyWord({ frequency: "every_n_days", every_n_days: 14 })).toBe("every 14 days");
    expect(frequencyWord({ frequency: "daily", every_n_days: null })).toBe("daily");
  });

  it("says who gave a dose", () => {
    expect(doseGiven("Vin", "Livy", "Simparica Trio")).toBe("Vin gave Livy Simparica Trio.");
  });

  it("writes a date without its year in this year, and without its day in another", () => {
    expect(shortDate("2026-10-20", TODAY)).toBe("Oct 20");
    expect(shortDate("2029-10-20", TODAY)).toBe("Oct 2029");
  });
});

describe("diet change notifications (REQ-190)", () => {
  it("says the first diet was set", () => {
    expect(dietMessage("Livy", null, diet(), TODAY)).toBe("Livy meal set: Hill's i/d, 150 g per meal.");
  });

  it("says a changed brand or product, with the food now", () => {
    const before = diet();
    const after = diet({ id: "d2", brand: "Royal Canin", product: "GI" });
    expect(dietMessage("Livy", before, after, TODAY)).toBe("Livy meal updated: Royal Canin GI, 150 g per meal.");
  });

  it("says changed grams", () => {
    const before = home({ grams_per_meal: 120 });
    const after = home({ id: "d2", grams_per_meal: 100, protein: "chicken" });
    expect(dietMessage("Xiao Wu", before, after, TODAY)).toBe("Xiao Wu meal updated: chicken, 100 g per meal.");
  });

  it("adds meals a day only when they changed", () => {
    const before = diet();
    expect(dietMessage("Livy", before, diet({ id: "d2", meals_per_day: 3 }), TODAY)).toBe(
      "Livy meal updated: Hill's i/d, 150 g per meal, 3 meals a day.",
    );
    expect(dietMessage("Livy", before, diet({ id: "d2", meals_per_day: 3, grams_per_meal: 100 }), TODAY)).toBe(
      "Livy meal updated: Hill's i/d, 100 g per meal, 3 meals a day.",
    );
  });

  it("says a home-cooked protein change, with or without a grams change", () => {
    const before = home();
    expect(dietMessage("Xiao Wu", before, home({ id: "d2", protein: "beef" }), TODAY)).toBe("Xiao Wu meal updated: beef, 120 g per meal.");
    expect(dietMessage("Xiao Wu", before, home({ id: "d2", protein: "beef", grams_per_meal: 130 }), TODAY)).toBe(
      "Xiao Wu meal updated: beef, 130 g per meal.",
    );
  });

  it("says a new batch of the same food, with when it runs out", () => {
    const before = home({ food_runs_out_on: "2026-10-05" });
    const after = home({ id: "d2", food_runs_out_on: "2026-10-20" });
    expect(dietMessage("Xiao Wu", before, after, TODAY)).toBe("Xiao Wu new batch: chicken, 120 g per meal. Runs out Oct 20.");
  });

  it("says the standard update for any other change, such as commercial to home-cooked", () => {
    expect(dietMessage("Livy", diet(), home({ id: "d2", grams_per_meal: 150 }), TODAY)).toBe("Livy meal updated: chicken, 150 g per meal.");
  });

  it("ends with the start date when the change started on an earlier day", () => {
    const after = home({ id: "d2", grams_per_meal: 100, started_on: "2026-10-05" });
    expect(dietMessage("Xiao Wu", home(), after, TODAY)).toBe("Xiao Wu meal updated: chicken, 100 g per meal. Since Oct 5.");
  });

  it("says nothing when a burst of edits ended where it began", () => {
    expect(dietMessage("Livy", diet(), diet({ id: "d3" }), TODAY)).toBeNull();
    // Only a batch prep date or notes changing never starts an entry, so there is no new id either.
    expect(dietMessage("Livy", home(), home({ batch_prep_on: "2026-10-01" }), TODAY)).toBeNull();
  });
});

const data = (extra: Partial<PetsData> = {}): PetsData => ({
  pets: [{ id: "livy", name: "Livy", nickname: null, species: "Dog", photo_path: null, archived_at: null, created_at: "2026-01-01T00:00:00Z" }],
  vaccines: [],
  diets: [],
  medications: [],
  links: [],
  doses: [],
  ...extra,
});

const medication = (extra: Partial<Medication> = {}): Medication => ({
  id: "m1",
  name: "Simparica Trio",
  purpose: null,
  dose: null,
  frequency: "monthly",
  every_n_days: null,
  starts_on: "2026-01-01",
  ends_on: null,
  prescribing_vet: null,
  doses_on_hand: null,
  doses_per_delivery: null,
  delivery_interval_months: null,
  last_delivery_on: null,
  lead_time_days: null,
  ...extra,
});

const vaccine = (next: string) => ({ id: "v1", pet_id: "livy", name: "DHPP", given_on: "2025-11-03", next_due_on: next, clinic: null, notes: null, created_at: "2025-11-03T10:00:00Z" });

describe("reminders for a date (REQ-192)", () => {
  it("reminds 30 days before a vaccine is due, on that day only", () => {
    expect(remindersDue(data({ vaccines: [vaccine("2026-11-07")] }), TODAY).map((r) => r.body)).toEqual(["Livy's DHPP is due Nov 7."]);
    expect(remindersDue(data({ vaccines: [vaccine("2026-11-06")] }), TODAY)).toEqual([]);
    expect(remindersDue(data({ vaccines: [vaccine("2026-11-08")] }), TODAY)).toEqual([]);
  });

  it("says a vaccine is overdue the day after it was due, with no newer entry", () => {
    expect(remindersDue(data({ vaccines: [vaccine("2026-10-07")] }), TODAY).map((r) => r.body)).toEqual([
      "Livy's DHPP is overdue (was due Oct 7).",
    ]);
    expect(remindersDue(data({ vaccines: [vaccine("2026-10-06")] }), TODAY)).toEqual([]);
  });

  it("is quiet about a vaccine with a newer entry", () => {
    const newer = { ...vaccine("2027-10-07"), id: "v2", given_on: "2026-10-07", created_at: "2026-10-07T10:00:00Z" };
    expect(remindersDue(data({ vaccines: [vaccine("2026-10-07"), newer] }), TODAY)).toEqual([]);
  });

  it("says a dose is due today, and 2 days overdue", () => {
    const base = { medications: [medication()] };
    expect(remindersDue(data({ ...base, links: [{ medication_id: "m1", pet_id: "livy", next_dose_on: TODAY }] }), TODAY).map((r) => r.body)).toEqual([
      "Livy's Simparica Trio is due today.",
    ]);
    expect(remindersDue(data({ ...base, links: [{ medication_id: "m1", pet_id: "livy", next_dose_on: "2026-10-06" }] }), TODAY).map((r) => r.body)).toEqual([
      "Livy's Simparica Trio is 2 days overdue.",
    ]);
    expect(remindersDue(data({ ...base, links: [{ medication_id: "m1", pet_id: "livy", next_dose_on: "2026-10-07" }] }), TODAY)).toEqual([]);
  });

  it("says when to order, and when the supply runs out", () => {
    // 2 on hand, monthly: runs out in 60 days (Dec 7); a 45-day lead puts the order-by date at Oct 23, so order-by is not here yet.
    const supply = medication({ doses_on_hand: 2, lead_time_days: 45 });
    const links = [{ medication_id: "m1", pet_id: "livy", next_dose_on: "2026-11-01" }];
    expect(remindersDue(data({ medications: [supply], links }), TODAY)).toEqual([]);
    // A 70-day lead puts it before today: time to order.
    const late = medication({ doses_on_hand: 2, lead_time_days: 70 });
    const [reminder] = remindersDue(data({ medications: [late], links }), TODAY);
    expect(reminder.body).toBe("Order Simparica Trio by Sep 28. Supply runs out Dec 7.");
    expect(reminder.topic).toBe("order-by:m1:start");
  });

  it("says a home-cooked batch runs out tomorrow", () => {
    const batch = home({ food_runs_out_on: "2026-10-09" });
    expect(remindersDue(data({ diets: [batch] }), TODAY).map((r) => r.body)).toEqual(["Livy's food runs out tomorrow (Oct 9)."]);
    expect(remindersDue(data({ diets: [home({ food_runs_out_on: "2026-10-10" })] }), TODAY)).toEqual([]);
  });

  it("never reminds about an archived pet", () => {
    const pets = [{ ...data().pets[0], archived_at: "2026-09-01T00:00:00Z" }];
    expect(remindersDue(data({ pets, vaccines: [vaccine("2026-10-07")] }), TODAY)).toEqual([]);
  });

  it("gives each reminder a topic of its own, so it is sent once", () => {
    const [a] = remindersDue(data({ vaccines: [vaccine("2026-10-07")] }), TODAY);
    const [b] = remindersDue(data({ vaccines: [vaccine("2026-11-07")] }), TODAY);
    expect(a.topic).toBe("vaccine-overdue:v1");
    expect(b.topic).toBe("vaccine-soon:v1");
  });
});
