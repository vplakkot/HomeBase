// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendPush } from "../notifications/send";
import { createAdminClient } from "../supabase/admin";
import { queueDietChange, runPetSchedule } from "./notify";

vi.mock("../supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("../notifications/send", () => ({ sendPush: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));

// Invented people and pets; nothing here is real.
const VIN = "11111111-1111-4111-8111-111111111111";
const SAM = "22222222-2222-4222-8222-222222222222";

type Rows = Record<string, unknown[]>;
let tables: Rows;
let written: { table: string; op: string; args: unknown[] }[];

// A stand-in for the secret-key client: a query answers with the table's
// rows; deletes and upserts answer with what they "claimed" (the rows, or
// none when the table is marked as already claimed).
let claimed: Record<string, boolean>;
function fakeAdmin() {
  return {
    from: (table: string) => {
      const rows = tables[table] ?? [];
      let op = "select";
      const query: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown) => {
          const taken = op === "select" ? rows : claimed[table] === false ? [] : rows.length ? rows : [{}];
          return Promise.resolve({ data: taken, error: null }).then(resolve);
        },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      };
      for (const method of ["select", "eq", "is", "in", "order"]) query[method] = vi.fn(() => query);
      query.lte = vi.fn((...args: unknown[]) => {
        written.push({ table, op: "lte", args });
        return query;
      });
      for (const method of ["upsert", "update", "delete", "insert"]) {
        query[method] = vi.fn((...args: unknown[]) => {
          op = method;
          written.push({ table, op: method, args });
          return query;
        });
      }
      return query;
    },
  };
}

const NOW = new Date("2026-10-08T16:00:00Z"); // 12:00 in the household

beforeEach(() => {
  vi.clearAllMocks();
  claimed = {};
  written = [];
  tables = {
    modules_off: [],
    household_members: [{ user_id: VIN }, { user_id: SAM }],
    pet_diet_pending: [],
    pets: [{ id: "p1", name: "Livy", nickname: null, species: "Dog", photo_path: null, archived_at: null, created_at: "2026-01-01T00:00:00Z" }],
    pet_vaccines: [],
    pet_diets: [],
    pet_medications: [],
    pet_medication_pets: [],
    pet_doses: [],
  };
  vi.mocked(createAdminClient).mockReturnValue(fakeAdmin() as unknown as ReturnType<typeof createAdminClient>);
  vi.mocked(sendPush).mockResolvedValue({ delivered: 1 } as Awaited<ReturnType<typeof sendPush>>);
});

const run = (now = NOW) => runPetSchedule({ subject: "https://homebase.example", now });

describe("sending a diet change once it has been quiet (REQ-190)", () => {
  const pending = (before: unknown) => ({ pet_id: "p1", actor: VIN, before_diet: before, last_edit_at: "2026-10-08T15:00:00Z" });
  const current = { id: "d2", kind: "prescription", brand: "Royal Canin", product: "GI", protein: null, batch_prep_on: null, food_runs_out_on: null, grams_per_meal: "150", meals_per_day: 2, started_on: "2026-10-08" };
  const before = { ...current, id: "d1", brand: "Hill's", product: "i/d" };

  it("tells everyone but the person who made the change, with the final values", async () => {
    tables.pet_diet_pending = [pending(before)];
    tables.pet_diets = [current];
    await run();
    expect(sendPush).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: "pets", to: [SAM], message: expect.objectContaining({ body: "Livy meal updated: Royal Canin GI, 150 g per meal." }) }),
    );
  });

  it("says the first diet was set when there was none before", async () => {
    tables.pet_diet_pending = [pending(null)];
    tables.pet_diets = [current];
    await run();
    expect(vi.mocked(sendPush).mock.calls[0][0].message.body).toBe("Livy meal set: Royal Canin GI, 150 g per meal.");
  });

  it("sends nothing for a pet that was archived, or when the edits ended where they began", async () => {
    tables.pet_diet_pending = [pending(before)];
    tables.pet_diets = [current];
    tables.pets = [{ ...(tables.pets[0] as object), archived_at: "2026-10-08T15:30:00Z" }];
    await run();
    expect(sendPush).not.toHaveBeenCalled();
    tables.pets = [{ name: "Livy", archived_at: null }];
    tables.pet_diets = [{ ...before, id: "d3" }];
    await run();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("leaves it to the run that claimed it first", async () => {
    tables.pet_diet_pending = [pending(before)];
    tables.pet_diets = [current];
    claimed.pet_diet_pending = false;
    await run();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("waits for the five quiet minutes: only changes at least that old are read", async () => {
    await run();
    const cutoff = written.find((entry) => entry.table === "pet_diet_pending" && entry.op === "lte");
    expect(cutoff?.args).toEqual(["last_edit_at", "2026-10-08T15:55:00.000Z"]);
  });
});

describe("sending the day's reminders (REQ-192)", () => {
  const overdueVaccine = { id: "v1", pet_id: "p1", name: "DHPP", given_on: "2025-10-07", next_due_on: "2026-10-07", clinic: null, notes: null, created_at: "2025-10-07T10:00:00Z" };

  it("sends a due reminder to everyone, once", async () => {
    tables.pet_vaccines = [overdueVaccine];
    expect(await run()).toEqual({ diets: 0, reminders: 1, quiet: false });
    expect(sendPush).toHaveBeenCalledWith(
      expect.objectContaining({ to: null, trigger: "pets", message: expect.objectContaining({ body: "Livy's DHPP is overdue (was due Oct 7)." }) }),
    );
    claimed.pet_pushes = false;
    vi.mocked(sendPush).mockClear();
    await run();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("holds reminders outside waking hours", async () => {
    tables.pet_vaccines = [overdueVaccine];
    const night = new Date("2026-10-08T05:00:00Z"); // 01:00 in the household
    expect(await run(night)).toEqual({ diets: 0, reminders: 0, quiet: true });
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("sends nothing while Pets is switched off", async () => {
    tables.modules_off = [{ module: "pets" }];
    tables.pet_vaccines = [overdueVaccine];
    expect(await run()).toEqual({ diets: 0, reminders: 0, quiet: true });
    expect(sendPush).not.toHaveBeenCalled();
  });
});

describe("queueing a diet change (REQ-190)", () => {
  it("keeps the first diet and only restarts the five minutes after that", async () => {
    await queueDietChange({ petId: "p1", actor: VIN, before: null });
    const ops = written.filter((entry) => entry.table === "pet_diet_pending").map((entry) => entry.op);
    expect(ops).toEqual(["upsert", "update"]);
    const upsert = written[0].args as [Record<string, unknown>, { ignoreDuplicates: boolean }];
    expect(upsert[1].ignoreDuplicates).toBe(true);
    expect(upsert[0]).toMatchObject({ pet_id: "p1", actor: VIN, before_diet: null });
  });
});
