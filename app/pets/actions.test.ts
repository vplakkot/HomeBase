import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import { fakeSupabase } from "../../test/fake-supabase";
import {
  addMedication,
  addPet,
  addVaccine,
  archivePet,
  markDelivery,
  markGiven,
  removePet,
  restorePet,
  saveDiet,
  undoDose,
  updateMedication,
  updatePet,
} from "./actions";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

// Invented ids; nothing here is real.
const PET = "11111111-1111-4111-8111-111111111111";
const PET2 = "22222222-2222-4222-8222-222222222222";
const MED = "33333333-3333-4333-8333-333333333333";
const ROW = "44444444-4444-4444-8444-444444444444";

let fake: ReturnType<typeof fakeSupabase>;

function given(tables: Record<string, unknown[]> = {}, permissions = ["use_modules"]) {
  fake = fakeSupabase({ permissions, tables });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
}

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) for (const each of [value].flat()) data.append(key, each);
  return data;
}

const on = (table: string) =>
  fake.from.mock.calls
    .map(([name], index) => (name === table ? fake.from.mock.results[index].value : null))
    .filter(Boolean) as Record<string, ReturnType<typeof vi.fn>>[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-08T16:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("a pet's profile (REQ-186)", () => {
  it("adds a pet with a name, nickname and species", async () => {
    given();
    expect(await addPet({}, form({ name: " Biscuit ", nickname: "Bisc", species: "Dog" }))).toEqual({ saved: true });
    expect(on("pets")[0].insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Biscuit", nickname: "Bisc", species: "Dog", photo_path: null }),
    );
  });

  it("adds a pet with a photo and its small copy, kept in the private bucket", async () => {
    given();
    const data = form({ name: "Biscuit", species: "Dog" });
    data.append("photo", new Blob(["full"], { type: "image/jpeg" }), "photo.jpg");
    data.append("photo_thumb", new Blob(["thumb"], { type: "image/jpeg" }), "photo-thumb.jpg");
    expect(await addPet({}, data)).toEqual({ saved: true });
    expect(fake.storage.from).toHaveBeenCalledWith("pet-photos");
    const paths = fake.storage.bucket.upload.mock.calls.map(([path]) => path);
    expect(paths[0]).toMatch(/^[0-9a-f-]{36}\/\d+\.jpg$/);
    expect(paths[1]).toBe(paths[0].replace(".jpg", "-thumb.jpg"));
    expect(on("pets")[0].insert).toHaveBeenCalledWith(expect.objectContaining({ photo_path: paths[0] }));
  });

  it("needs a name and a species", async () => {
    given();
    expect(await addPet({}, form({ name: " ", species: "Dog" }))).toEqual({ error: "Give the pet a name." });
    expect(await addPet({}, form({ name: "Biscuit", species: "" }))).toEqual({ error: "Say what kind of pet it is." });
    expect(fake.from).not.toHaveBeenCalledWith("pets");
  });

  it("changes a pet's details", async () => {
    given({ pets: [{ photo_path: null }] });
    expect(await updatePet({}, form({ id: PET, name: "Biscuit", nickname: "", species: "Cat" }))).toEqual({ saved: true });
    expect(on("pets").at(-1)!.update).toHaveBeenCalledWith({ name: "Biscuit", nickname: null, species: "Cat" });
  });

  it("archives a pet, keeping its records, and restores it", async () => {
    given();
    await expect(archivePet({}, form({ id: PET }))).rejects.toThrow("REDIRECT:/pets");
    expect(on("pets")[0].update).toHaveBeenCalledWith({ archived_at: expect.stringMatching(/^2026-10-08/) });
    expect(fake.from).not.toHaveBeenCalledWith("pet_vaccines");
    await expect(restorePet({}, form({ id: PET }))).rejects.toThrow(`REDIRECT:/pets/${PET}`);
    expect(on("pets")[1].update).toHaveBeenCalledWith({ archived_at: null });
  });

  it("removes a profile for good only once it is archived", async () => {
    given({ pets: [{ photo_path: null, archived_at: null }] });
    expect(await removePet({}, form({ id: PET }))).toEqual({ error: "Archive the pet first." });
    given({ pets: [{ photo_path: "p/1.jpg", archived_at: "2026-10-01T00:00:00Z" }] });
    await expect(removePet({}, form({ id: PET }))).rejects.toThrow("REDIRECT:/pets/archived");
    expect(on("pets")[1].delete).toHaveBeenCalled();
    expect(fake.storage.bucket.remove).toHaveBeenCalledWith(["p/1.jpg", "p/1-thumb.jpg"]);
  });

  it("is refused to someone who can't use modules", async () => {
    given({}, []);
    await expect(addPet({}, form({ name: "Biscuit", species: "Dog" }))).rejects.toThrow("REDIRECT:/pets");
  });
});

describe("logging a vaccine (REQ-187)", () => {
  const fields = { petId: PET, name: "Rabies", givenOn: "2026-10-01", nextDueOn: "2027-10-01", clinic: "Maple Vets", notes: "" };

  it("keeps the next due date exactly as typed", async () => {
    given();
    expect(await addVaccine({}, form(fields))).toEqual({ saved: true });
    expect(on("pet_vaccines")[0].insert).toHaveBeenCalledWith({
      pet_id: PET,
      name: "Rabies",
      given_on: "2026-10-01",
      next_due_on: "2027-10-01",
      clinic: "Maple Vets",
      notes: null,
    });
  });

  it("adds a new dose without touching the earlier entries", async () => {
    given();
    await addVaccine({}, form({ ...fields, givenOn: "2027-10-01", nextDueOn: "2028-10-01" }));
    const queries = on("pet_vaccines");
    expect(queries).toHaveLength(1);
    expect(queries[0].update).not.toHaveBeenCalled();
    expect(queries[0].delete).not.toHaveBeenCalled();
  });

  it("needs a name, both dates, and a due date that isn't before the day it was given", async () => {
    given();
    expect(await addVaccine({}, form({ ...fields, name: "" }))).toEqual({ error: "Name the vaccine." });
    expect(await addVaccine({}, form({ ...fields, givenOn: "" }))).toEqual({ error: "Say the date it was given." });
    expect(await addVaccine({}, form({ ...fields, nextDueOn: "" }))).toEqual({ error: "Say when the next one is due." });
    expect(await addVaccine({}, form({ ...fields, nextDueOn: "2026-09-01" }))).toEqual({
      error: "The next due date can't be before the date it was given.",
    });
  });
});

describe("setting a diet (REQ-188)", () => {
  const commercial = { petId: PET, kind: "commercial", brand: "Acme", product: "Salmon", purpose: "GI", grams: "120", meals: "2", notes: "" };
  const current = {
    id: ROW,
    kind: "commercial",
    brand: "Acme",
    product: "Salmon",
    protein: null,
    grams_per_meal: "120",
    meals_per_day: 2,
    started_on: "2026-09-01",
  };
  const inserted = () => on("pet_diets").some((query) => query.insert.mock.calls.length > 0);

  it("holds brand, product, purpose, grams and meals for a commercial or prescription food", async () => {
    given();
    expect(await saveDiet({}, form(commercial))).toEqual({ saved: true });
    expect(on("pet_diets").at(-1)!.insert).toHaveBeenCalledWith({
      pet_id: PET,
      kind: "commercial",
      brand: "Acme",
      product: "Salmon",
      purpose: "GI",
      protein: null,
      batch_prep_on: null,
      grams_per_meal: 120,
      meals_per_day: 2,
      notes: null,
      started_on: "2026-10-08",
    });
    given();
    await saveDiet({}, form({ ...commercial, kind: "prescription" }));
    expect(on("pet_diets").at(-1)!.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "prescription" }));
  });

  it("holds protein, grams, meals, batch prep date and recipe notes for a home-cooked diet", async () => {
    given();
    expect(
      await saveDiet(
        {},
        form({ petId: PET, kind: "home_cooked", protein: "Chicken", batchPrepOn: "2026-10-05", grams: "85.5", meals: "3", notes: "Rice, carrots" }),
      ),
    ).toEqual({ saved: true });
    expect(on("pet_diets").at(-1)!.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "home_cooked",
        brand: null,
        protein: "Chicken",
        batch_prep_on: "2026-10-05",
        grams_per_meal: 85.5,
        meals_per_day: 3,
        notes: "Rice, carrots",
      }),
    );
  });

  it("ends the current entry and starts a new one when the grams change", async () => {
    given({ pet_diets: [current] });
    expect(await saveDiet({}, form({ ...commercial, grams: "140" }))).toEqual({ saved: true });
    const queries = on("pet_diets");
    expect(queries.some((query) => query.update.mock.calls.some(([args]) => args.ended_on === "2026-10-08"))).toBe(true);
    expect(queries.at(-1)!.insert).toHaveBeenCalledWith(expect.objectContaining({ grams_per_meal: 140, started_on: "2026-10-08" }));
  });

  it("starts a new entry when the type, food or meals change", async () => {
    for (const change of [{ kind: "prescription" }, { product: "Beef" }, { brand: "Other" }, { meals: "3" }]) {
      given({ pet_diets: [current] });
      await saveDiet({}, form({ ...commercial, ...change }));
      expect(inserted(), JSON.stringify(change)).toBe(true);
    }
  });

  it("starts a new entry when the protein of a home-cooked diet changes", async () => {
    const home = { ...current, kind: "home_cooked", brand: null, product: null, protein: "chicken" };
    given({ pet_diets: [home] });
    await saveDiet({}, form({ petId: PET, kind: "home_cooked", protein: "turkey", grams: "120", meals: "2" }));
    expect(inserted()).toBe(true);
  });

  it("updates the entry in place when only the notes change", async () => {
    given({ pet_diets: [current] });
    expect(await saveDiet({}, form({ ...commercial, purpose: "", notes: "Warm it up" }))).toEqual({ saved: true });
    expect(inserted()).toBe(false);
    expect(on("pet_diets").at(-1)!.update).toHaveBeenCalledWith({ purpose: null, batch_prep_on: null, notes: "Warm it up" });
  });

  it("needs the fields its type asks for", async () => {
    given();
    expect(await saveDiet({}, form({ ...commercial, brand: "" }))).toEqual({ error: "Give the brand and the product." });
    expect(await saveDiet({}, form({ petId: PET, kind: "home_cooked", protein: "", grams: "80", meals: "2" }))).toEqual({
      error: "Say the protein, for example chicken.",
    });
    expect(await saveDiet({}, form({ ...commercial, grams: "0" }))).toEqual({ error: "Say how many grams a meal." });
    expect(await saveDiet({}, form({ ...commercial, meals: "" }))).toEqual({ error: "Say how many meals a day." });
    expect(await saveDiet({}, form({ ...commercial, kind: "raw" }))).toEqual({ error: "Choose a type of diet." });
  });
});

describe("medications (REQ-189)", () => {
  const fields = {
    name: "Chewable",
    purpose: "Flea, tick and heartworm",
    dose: "1 tablet",
    frequency: "monthly",
    startsOn: "2026-10-10",
    ongoing: "yes",
    prescribingVet: "Dr Made-Up",
    dosesOnHand: "6",
    dosesPerDelivery: "6",
    deliveryIntervalMonths: "3",
    lastDeliveryOn: "2026-09-20",
    leadTimeDays: "10",
  };

  it("adds one product and links it to each pet that takes it, first dose due on the start date", async () => {
    given({ pet_medications: [{ id: MED }] });
    expect(await addMedication({}, form({ ...fields, petIds: [PET, PET2] }))).toEqual({ saved: true });
    expect(on("pet_medications")[0].insert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Chewable",
        purpose: "Flea, tick and heartworm",
        dose: "1 tablet",
        frequency: "monthly",
        starts_on: "2026-10-10",
        ends_on: null,
        prescribing_vet: "Dr Made-Up",
        doses_on_hand: 6,
        doses_per_delivery: 6,
        delivery_interval_months: 3,
        last_delivery_on: "2026-09-20",
        lead_time_days: 10,
      }),
    );
    expect(on("pet_medication_pets")[0].insert).toHaveBeenCalledWith([
      { medication_id: MED, pet_id: PET, next_dose_on: "2026-10-10" },
      { medication_id: MED, pet_id: PET2, next_dose_on: "2026-10-10" },
    ]);
  });

  it("takes a frequency of every N days, and an end date instead of ongoing", async () => {
    given({ pet_medications: [{ id: MED }] });
    await addMedication(
      {},
      form({ ...fields, ongoing: "", frequency: "every_n_days", everyNDays: "14", endsOn: "2026-12-31", petIds: PET }),
    );
    expect(on("pet_medications")[0].insert).toHaveBeenCalledWith(
      expect.objectContaining({ frequency: "every_n_days", every_n_days: 14, ends_on: "2026-12-31" }),
    );
  });

  it("needs a name, at least one pet, a start date, and an end date or Ongoing", async () => {
    given();
    expect(await addMedication({}, form({ ...fields, name: "", petIds: PET }))).toEqual({ error: "Name the medication." });
    expect(await addMedication({}, form({ ...fields }))).toEqual({ error: "Choose at least one pet that takes it." });
    expect(await addMedication({}, form({ ...fields, startsOn: "", petIds: PET }))).toEqual({ error: "Say the date it starts." });
    expect(await addMedication({}, form({ ...fields, ongoing: "", petIds: PET }))).toEqual({
      error: "Give an end date, or tick Ongoing.",
    });
    expect(await addMedication({}, form({ ...fields, frequency: "every_n_days", petIds: PET }))).toEqual({
      error: "Say how many days between doses.",
    });
    expect(fake.from).not.toHaveBeenCalledWith("pet_medications");
  });

  it("links a pet added later and unlinks one taken off", async () => {
    given({ pet_medication_pets: [{ pet_id: PET }, { pet_id: PET2 }] });
    const PET3 = "55555555-5555-4555-8555-555555555555";
    expect(await updateMedication({}, form({ ...fields, id: MED, petIds: [PET, PET3] }))).toEqual({ saved: true });
    const links = on("pet_medication_pets");
    expect(links.some((query) => query.insert.mock.calls.some(([rows]) => rows[0].pet_id === PET3 && rows.length === 1))).toBe(true);
    expect(links.some((query) => query.delete.mock.calls.length > 0 && query.in.mock.calls.some(([, ids]) => ids[0] === PET2))).toBe(true);
  });

  describe("Mark given", () => {
    const med = { frequency: "monthly", every_n_days: null, ends_on: null, doses_on_hand: 6 };

    it("logs the dose with the day, moves the next dose one interval on, and takes one off the doses on hand", async () => {
      given({ pet_medications: [med], pet_medication_pets: [{ next_dose_on: "2026-10-10" }] });
      expect(await markGiven({}, form({ medicationId: MED, petId: PET }))).toEqual({ saved: true });
      expect(on("pet_medication_pets").at(-1)!.update).toHaveBeenCalledWith({ next_dose_on: "2026-11-10" });
      expect(on("pet_doses")[0].insert).toHaveBeenCalledWith({
        medication_id: MED,
        pet_id: PET,
        given_on: "2026-10-08",
        previous_next_dose_on: "2026-10-10",
      });
      expect(on("pet_medications").at(-1)!.update).toHaveBeenCalledWith({ doses_on_hand: 5 });
    });

    it("does not count a dose when supply isn't tracked", async () => {
      given({ pet_medications: [{ ...med, doses_on_hand: null }], pet_medication_pets: [{ next_dose_on: "2026-10-10" }] });
      await markGiven({}, form({ medicationId: MED, petId: PET }));
      expect(on("pet_medications").every((query) => query.update.mock.calls.length === 0)).toBe(true);
    });

    it("has nothing to mark once the course has ended", async () => {
      given({ pet_medications: [med], pet_medication_pets: [{ next_dose_on: null }] });
      expect(await markGiven({}, form({ medicationId: MED, petId: PET }))).toEqual({ error: "This course has ended." });
      expect(fake.from).not.toHaveBeenCalledWith("pet_doses");
    });
  });

  describe("Undo last dose", () => {
    const dose = { medication_id: MED, pet_id: PET, previous_next_dose_on: "2026-10-10", created_at: "2026-10-08T16:00:00Z" };

    it("puts back the next dose and the dose on hand, and removes the dose", async () => {
      given({ pet_doses: [dose], pet_medications: [{ doses_on_hand: 5 }] });
      // The fake answers every query on a table with the same rows, so no later dose is found
      // by returning none for the "later than this" lookup (the second read of the table).
      const real = fake.from.getMockImplementation()!;
      let doseReads = 0;
      fake.from.mockImplementation(((table: string) => {
        if (table === "pet_doses" && ++doseReads === 2) return fakeSupabase({ tables: { pet_doses: [] } }).from(table);
        return real(table);
      }) as never);
      expect(await undoDose({}, form({ id: ROW }))).toEqual({ saved: true });
      expect(on("pet_medication_pets")[0].update).toHaveBeenCalledWith({ next_dose_on: "2026-10-10" });
      expect(on("pet_medications").at(-1)!.update).toHaveBeenCalledWith({ doses_on_hand: 6 });
      expect(on("pet_doses").some((query) => query.delete.mock.calls.length > 0)).toBe(true);
    });

    it("refuses a dose that isn't the latest", async () => {
      given({ pet_doses: [dose] });
      // Every read of the table finds a dose, so one is "later".
      expect(await undoDose({}, form({ id: ROW }))).toEqual({ error: "Only the latest dose can be undone." });
      expect(fake.from).not.toHaveBeenCalledWith("pet_medication_pets");
    });
  });

  describe("Mark delivery received", () => {
    it("adds a delivery's worth to the doses on hand and dates the last delivery today", async () => {
      given({ pet_medications: [{ doses_on_hand: 2, doses_per_delivery: 6 }] });
      expect(await markDelivery({}, form({ id: MED }))).toEqual({ saved: true });
      expect(on("pet_medications").at(-1)!.update).toHaveBeenCalledWith({ doses_on_hand: 8, last_delivery_on: "2026-10-08" });
    });

    it("needs doses per delivery to be set", async () => {
      given({ pet_medications: [{ doses_on_hand: 2, doses_per_delivery: null }] });
      expect(await markDelivery({}, form({ id: MED }))).toEqual({ error: "Set doses per delivery first (Edit)." });
    });
  });
});
