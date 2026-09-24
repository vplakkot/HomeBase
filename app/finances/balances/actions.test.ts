import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../../lib/supabase/server";
import { fakeSupabase } from "../../../test/fake-supabase";
import { removeBalances, saveBalances } from "./actions";

vi.mock("../../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

let fake: ReturnType<typeof fakeSupabase>;

function given({ member = true } = {}) {
  fake = fakeSupabase({ permissions: member ? ["use_modules"] : [] });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
}

function form(fields: [string, string][]): FormData {
  const data = new FormData();
  for (const [key, value] of fields) data.append(key, value);
  return data;
}

const queries = () =>
  fake.from.mock.calls
    .map(([table], index) => (table === "balances" ? fake.from.mock.results[index].value : null))
    .filter(Boolean) as Record<string, ReturnType<typeof vi.fn>>[];

const alex = (boxes: Record<string, string>, month = "2026-09-01"): [string, string][] => [
  ["month", month],
  ["userId", "u-alex"],
  ...Object.entries(boxes),
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-24T16:00:00Z"));
  given();
});
afterEach(() => vi.useRealTimers());

describe("saveBalances (REQ-67)", () => {
  it("saves the filled boxes and takes out the blank ones, so the rest still save", async () => {
    const result = await saveBalances({}, form(alex({ "401k": "12,000.50", espp: "0", rsu: "", investments: "$300", cash: "" })));
    expect(result).toEqual({ saved: true });
    const [upsert, clear] = queries();
    expect(upsert.upsert.mock.calls[0][0].map((row: { account: string; amount: number }) => [row.account, row.amount])).toEqual([
      ["401k", 12000.5],
      ["espp", 0],
      ["investments", 300],
    ]);
    expect(clear.delete).toHaveBeenCalled();
    expect(clear.eq.mock.calls).toEqual([["month", "2026-09-01"], ["user_id", "u-alex"]]);
    expect(clear.in).toHaveBeenCalledWith("account", ["rsu", "cash"]);
  });

  it("refuses amounts that aren't money, and saves nothing", async () => {
    const result = await saveBalances({}, form(alex({ cash: "lots" })));
    expect(result.error).toMatch(/Enter amounts/);
    expect(queries()).toEqual([]);
  });

  it("refuses a month still to come", async () => {
    const result = await saveBalances({}, form(alex({ cash: "10" }, "2026-10-01")));
    expect(result.error).toBe("Pick this month or an earlier one.");
    expect(queries()).toEqual([]);
  });

  it("sends someone without module access away", async () => {
    given({ member: false });
    await expect(saveBalances({}, form(alex({ cash: "10" })))).rejects.toThrow("REDIRECT:/finances");
  });
});

describe("removeBalances", () => {
  it("takes away every balance for the month", async () => {
    await removeBalances(form([["month", "2026-09-01"]]));
    const [remove] = queries();
    expect(remove.delete).toHaveBeenCalled();
    expect(remove.eq).toHaveBeenCalledWith("month", "2026-09-01");
  });
});
