import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../../lib/supabase/server";
import { fakeSupabase } from "../../../test/fake-supabase";
import { logIncome } from "./actions";

vi.mock("../../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

let fake: ReturnType<typeof fakeSupabase>;

function given({ member = true } = {}) {
  fake = fakeSupabase({
    permissions: member ? ["use_modules"] : [],
    tables: { months: [{ starts_on: "2026-09-01" }] },
  });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const incomeQuery = () => {
  const call = fake.from.mock.calls.findIndex(([table]) => table === "month_income");
  return fake.from.mock.results[call]?.value as Record<string, ReturnType<typeof vi.fn>> | undefined;
};

const base = { monthId: "m-sep", ownerId: "u-sam", kind: "rsu", amount: "3,100", receivedOn: "2026-09-12" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-22T16:00:00Z"));
});

describe("logIncome (REQ-60)", () => {
  it("logs the kind, whose it is, the amount and the day it landed", async () => {
    given();
    expect(await logIncome({}, form(base))).toEqual({ saved: true });
    expect(incomeQuery()?.insert).toHaveBeenCalledWith({
      month_id: "m-sep",
      owner_id: "u-sam",
      kind: "rsu",
      amount: 3100,
      received_on: "2026-09-12",
      income_source_id: null,
      note: "",
    });
  });

  it("keeps which income source and payday a confirmed paycheck was", async () => {
    given();
    await logIncome({}, form({ ...base, kind: "paycheck", sourceId: "src-alex", receivedOn: "2026-09-18" }));
    expect(incomeQuery()?.insert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "paycheck", income_source_id: "src-alex", received_on: "2026-09-18" }),
    );
  });

  it("refuses a kind it doesn't know, like shares held", async () => {
    given();
    expect(await logIncome({}, form({ ...base, kind: "held" }))).toEqual({ error: "Choose what kind of income it is." });
    expect(incomeQuery()).toBeUndefined();
  });

  it("refuses a day outside the month, or one still to come", async () => {
    given();
    expect(await logIncome({}, form({ ...base, receivedOn: "2026-10-01" }))).toEqual({
      error: "The day it landed has to be in this month.",
    });
    expect(await logIncome({}, form({ ...base, receivedOn: "2026-09-25" }))).toEqual({
      error: "Only money that has landed counts, so the day can't be in the future.",
    });
  });

  it("sends someone without the members' key back to Finances", async () => {
    given({ member: false });
    await expect(logIncome({}, form(base))).rejects.toThrow("REDIRECT:/finances");
  });
});
