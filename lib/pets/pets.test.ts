import { describe, expect, it } from "vitest";
import {
  addMonths,
  afterDelivery,
  dateText,
  afterMarkGiven,
  currentDiet,
  dietChanged,
  dietHistory,
  dietLine,
  medicationsFor,
  petsTile,
  supplyOf,
  vaccineHistories,
  vaccineStatus,
  type Diet,
  type Medication,
  type MedicationPet,
  type Pet,
  type Vaccine,
} from "./pets";

// Invented pets and records; nothing here is real.
const TODAY = "2026-10-08";

const vaccine = (id: string, name: string, given_on: string, next_due_on: string, extra: Partial<Vaccine> = {}): Vaccine => ({
  id,
  pet_id: "p1",
  name,
  given_on,
  next_due_on,
  clinic: null,
  notes: null,
  created_at: `${given_on}T10:00:00Z`,
  ...extra,
});

const diet = (id: string, extra: Partial<Diet> = {}): Diet => ({
  id,
  pet_id: "p1",
  kind: "commercial",
  brand: "Acme",
  product: "Sensitive Salmon",
  purpose: null,
  protein: null,
  batch_prep_on: null,
  grams_per_meal: 120,
  meals_per_day: 2,
  notes: null,
  started_on: "2026-09-01",
  ended_on: null,
  ...extra,
});

const med = (extra: Partial<Medication> = {}): Medication => ({
  id: "m1",
  name: "Chewable",
  purpose: "Flea and tick",
  dose: "1 tablet",
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

const pet = (id: string, extra: Partial<Pet> = {}): Pet => ({
  id,
  name: id,
  nickname: null,
  species: "Dog",
  photo_path: null,
  archived_at: null,
  created_at: "2026-09-01T00:00:00Z",
  ...extra,
});

describe("vaccine status (REQ-187)", () => {
  it("is overdue once the due date has passed", () => {
    expect(vaccineStatus("2026-10-07", TODAY)).toBe("overdue");
  });
  it("is due soon from today up to 30 days ahead", () => {
    expect(vaccineStatus("2026-10-08", TODAY)).toBe("due soon");
    expect(vaccineStatus("2026-11-07", TODAY)).toBe("due soon");
  });
  it("is current beyond 30 days", () => {
    expect(vaccineStatus("2026-11-08", TODAY)).toBe("current");
  });
});

describe("a pet's vaccines (REQ-187)", () => {
  const rows = [
    vaccine("a", "Rabies", "2024-10-01", "2025-10-01"),
    vaccine("b", "Rabies", "2025-10-02", "2026-10-02"),
    vaccine("c", "rabies ", "2026-10-03", "2027-10-03"),
    vaccine("d", "Bordetella", "2026-04-01", "2026-10-20"),
    vaccine("e", "Rabies", "2026-01-01", "2030-01-01", { pet_id: "p2" }),
  ];
  const histories = vaccineHistories(rows, "p1", TODAY);

  it("shows the latest entry per vaccine, however the name is typed", () => {
    expect(histories.map((history) => [history.name, history.latest.id])).toEqual([
      ["Bordetella", "d"],
      ["rabies ", "c"],
    ]);
  });
  it("keeps the earlier entries as history, newest first", () => {
    expect(histories[1].entries.map((entry) => entry.id)).toEqual(["c", "b", "a"]);
  });
  it("gives each vaccine its status from its latest entry", () => {
    expect(histories.map((history) => history.status)).toEqual(["due soon", "current"]);
  });
  it("leaves other pets' vaccines out", () => {
    expect(histories.flatMap((history) => history.entries).some((entry) => entry.pet_id === "p2")).toBe(false);
  });
  it("breaks a tie on the day by the one logged last", () => {
    const tied = vaccineHistories(
      [
        vaccine("x", "Lepto", "2026-05-01", "2027-05-01", { created_at: "2026-05-01T08:00:00Z" }),
        vaccine("y", "Lepto", "2026-05-01", "2027-06-01", { created_at: "2026-05-01T09:00:00Z" }),
      ],
      "p1",
      TODAY,
    );
    expect(tied[0].latest.id).toBe("y");
  });
});

describe("diet (REQ-188)", () => {
  it("finds the current entry and the history newest first", () => {
    const diets = [
      diet("old", { started_on: "2026-01-01", ended_on: "2026-08-31" }),
      diet("now"),
      diet("other", { pet_id: "p2" }),
    ];
    expect(currentDiet(diets, "p1")?.id).toBe("now");
    expect(dietHistory(diets, "p1").map((entry) => entry.id)).toEqual(["now", "old"]);
    expect(currentDiet([diet("old", { ended_on: "2026-09-30" })], "p1")).toBeNull();
  });
  it("shows the food and grams per meal for the pet card", () => {
    expect(dietLine(diet("x"))).toBe("Acme Sensitive Salmon · 120 g a meal");
    expect(dietLine(diet("x", { kind: "home_cooked", brand: null, product: null, protein: "chicken", grams_per_meal: 85.5 }))).toBe(
      "Home-cooked chicken · 85.5 g a meal",
    );
  });
  it("starts a new entry for a change of type, food, protein, grams or meals", () => {
    const current = diet("x");
    expect(dietChanged(current, { ...current, kind: "prescription" })).toBe(true);
    expect(dietChanged(current, { ...current, brand: "Other" })).toBe(true);
    expect(dietChanged(current, { ...current, product: "Beef" })).toBe(true);
    expect(dietChanged(current, { ...current, protein: "turkey" })).toBe(true);
    expect(dietChanged(current, { ...current, grams_per_meal: 130 })).toBe(true);
    expect(dietChanged(current, { ...current, meals_per_day: 3 })).toBe(true);
  });
  it("updates in place when only the spelling of the name or nothing but the notes changed", () => {
    const current = diet("x");
    expect(dietChanged(current, { ...current, brand: " acme " })).toBe(false);
    expect(dietChanged(current, current)).toBe(false);
  });
});

describe("dates", () => {
  it("writes a day with its year", () => {
    expect(dateText("2026-10-08")).toBe("8 Oct 2026");
  });
  it("adds a month without spilling into the next", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });
});

describe("Mark given (REQ-189)", () => {
  it("moves the next dose forward by one interval from when it was due", () => {
    expect(afterMarkGiven(med({ frequency: "daily" }), "2026-10-08", TODAY)).toBe("2026-10-09");
    expect(afterMarkGiven(med({ frequency: "monthly" }), "2026-10-10", TODAY)).toBe("2026-11-10");
    expect(afterMarkGiven(med({ frequency: "every_n_days", every_n_days: 3 }), "2026-10-09", TODAY)).toBe("2026-10-12");
  });
  it("counts from today when the dose was late", () => {
    expect(afterMarkGiven(med({ frequency: "monthly" }), "2026-09-01", TODAY)).toBe("2026-11-08");
    expect(afterMarkGiven(med(), null, TODAY)).toBe("2026-11-08");
  });
  it("ends the course when the next dose falls after the end date", () => {
    expect(afterMarkGiven(med({ frequency: "daily", ends_on: "2026-10-08" }), "2026-10-08", TODAY)).toBeNull();
    expect(afterMarkGiven(med({ frequency: "daily", ends_on: "2026-10-09" }), "2026-10-08", TODAY)).toBe("2026-10-09");
  });
});

describe("supply (REQ-189)", () => {
  it("works monthly use as doses per pet per month times the pets", () => {
    expect(supplyOf(med({ doses_on_hand: 6 }), 2, TODAY)?.monthlyUse).toBe(2);
    expect(supplyOf(med({ frequency: "daily", doses_on_hand: 60 }), 1, TODAY)?.monthlyUse).toBe(30);
    expect(supplyOf(med({ frequency: "every_n_days", every_n_days: 15, doses_on_hand: 6 }), 2, TODAY)?.monthlyUse).toBe(4);
  });
  it("works the run-out date as today plus doses on hand over monthly use", () => {
    // 6 doses, 2 a month: three months, 90 days.
    expect(supplyOf(med({ doses_on_hand: 6 }), 2, TODAY)?.runOutOn).toBe("2027-01-06");
  });
  it("works the order-by date as the run-out date less the lead time", () => {
    expect(supplyOf(med({ doses_on_hand: 6, lead_time_days: 10 }), 2, TODAY)?.orderByOn).toBe("2026-12-27");
    expect(supplyOf(med({ doses_on_hand: 6 }), 2, TODAY)?.orderByOn).toBeNull();
  });
  it("works the next delivery as the last one plus the interval", () => {
    const supply = supplyOf(med({ doses_on_hand: 6, last_delivery_on: "2026-09-20", delivery_interval_months: 3 }), 2, TODAY);
    expect(supply?.nextDeliveryOn).toBe("2026-12-20");
  });
  it("warns of a gap when the run-out date is before the next delivery", () => {
    const base = { last_delivery_on: "2026-09-20", delivery_interval_months: 3 };
    expect(supplyOf(med({ ...base, doses_on_hand: 3 }), 2, TODAY)?.gap).toBe(true); // runs out 2026-11-22
    expect(supplyOf(med({ ...base, doses_on_hand: 6 }), 2, TODAY)?.gap).toBe(false); // runs out 2027-01-06
  });
  it("has no gap without an auto-delivery", () => {
    expect(supplyOf(med({ doses_on_hand: 1 }), 1, TODAY)?.gap).toBe(false);
  });
  it("works nothing without doses on hand, pets, or once the course has ended", () => {
    expect(supplyOf(med(), 1, TODAY)).toBeNull();
    expect(supplyOf(med({ doses_on_hand: 5 }), 0, TODAY)).toBeNull();
    expect(supplyOf(med({ doses_on_hand: 5, ends_on: "2026-10-01" }), 1, TODAY)).toBeNull();
  });
  it("runs out today with none on hand", () => {
    expect(supplyOf(med({ doses_on_hand: 0 }), 1, TODAY)?.runOutOn).toBe(TODAY);
  });
  it("adds a delivery to the doses on hand and dates it today", () => {
    expect(afterDelivery({ doses_on_hand: 2, doses_per_delivery: 6 }, TODAY)).toEqual({
      doses_on_hand: 8,
      last_delivery_on: TODAY,
    });
    expect(afterDelivery({ doses_on_hand: null, doses_per_delivery: 6 }, TODAY).doses_on_hand).toBe(6);
  });
});

describe("a pet's medications (REQ-189)", () => {
  const pets = [pet("p1"), pet("p2"), pet("p3", { archived_at: "2026-09-30T00:00:00Z" })];
  const medications = [
    med({ id: "m1", doses_on_hand: 6 }),
    med({ id: "m2", name: "Allergy tablet", frequency: "daily" }),
    med({ id: "m3", name: "Old course" }),
  ];
  const links: MedicationPet[] = [
    { medication_id: "m1", pet_id: "p1", next_dose_on: "2026-10-20" },
    { medication_id: "m1", pet_id: "p2", next_dose_on: "2026-10-21" },
    { medication_id: "m1", pet_id: "p3", next_dose_on: "2026-10-22" },
    { medication_id: "m2", pet_id: "p1", next_dose_on: "2026-10-09" },
    { medication_id: "m3", pet_id: "p1", next_dose_on: null },
  ];
  const mine = medicationsFor("p1", medications, links, pets, TODAY);

  it("lists the one that is due soonest first and ended courses last", () => {
    expect(mine.map((row) => row.medication.id)).toEqual(["m2", "m1", "m3"]);
  });
  it("counts only the pets that are not archived toward monthly use", () => {
    // 1 dose a month for each of two pets: 2 a month, so 6 doses last 3 months.
    expect(mine[1].supply?.monthlyUse).toBe(2);
    expect(mine[1].petIds).toEqual(["p1", "p2", "p3"]);
  });
  it("leaves out another pet's medications", () => {
    expect(medicationsFor("p2", medications, links, pets, TODAY).map((row) => row.medication.id)).toEqual(["m1"]);
  });
});

describe("Home's tile", () => {
  it("says how many pets there are", () => {
    expect(petsTile(0).status).toBe("No pets yet");
    expect(petsTile(1).status).toBe("1 pet");
    expect(petsTile(3).status).toBe("3 pets");
    expect(petsTile(3).actionItems).toEqual([]);
  });
});
