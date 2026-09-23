import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../../lib/supabase/server";
import { fakeSupabase } from "../../../test/fake-supabase";
import { recordSavings, removeSavings } from "./actions";

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

const savingsQuery = () => {
  const call = fake.from.mock.calls.findIndex(([table]) => table === "month_savings");
  return fake.from.mock.results[call]?.value as Record<string, ReturnType<typeof vi.fn>> | undefined;
};

const both: [string, string][] = [
  ["monthId", "m-sep"],
  ["userId", "u-alex"],
  ["joint-u-alex", "$100"],
  ["own-u-alex", "1,200.50"],
  ["userId", "u-sam"],
  ["joint-u-sam", "100.00"],
  ["own-u-sam", ""],
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordSavings (REQ-66)", () => {
  it("records what each person put into joint and saved on their own, blank meaning nothing", async () => {
    given();
    expect(await recordSavings({}, form(both))).toEqual({ saved: true });
    const [rows, options] = savingsQuery()!.upsert.mock.calls[0];
    expect(rows.map(({ updated_at: _, ...row }: Record<string, unknown>) => row)).toEqual([
      { month_id: "m-sep", user_id: "u-alex", to_joint: 100, own: 1200.5 },
      { month_id: "m-sep", user_id: "u-sam", to_joint: 100, own: 0 },
    ]);
    expect(options).toEqual({ onConflict: "month_id,user_id" });
  });

  it("refuses an amount it can't read, saving nothing", async () => {
    given();
    const bad = both.map(([key, value]): [string, string] => [key, key === "own-u-sam" ? "lots" : value]);
    expect(await recordSavings({}, form(bad))).toEqual({ error: "Enter amounts like 50 or 50.00, or leave a box blank." });
    expect(savingsQuery()).toBeUndefined();
  });

  it("sends someone who can't use the modules back to Finances", async () => {
    given({ member: false });
    await expect(recordSavings({}, form(both))).rejects.toThrow("REDIRECT:/finances");
  });
});

describe("removeSavings (REQ-66)", () => {
  it("takes the month's whole record away, back to not recorded", async () => {
    given();
    await removeSavings(form([["monthId", "m-sep"]]));
    expect(savingsQuery()!.delete).toHaveBeenCalled();
    expect(savingsQuery()!.eq).toHaveBeenCalledWith("month_id", "m-sep");
  });

  it("sends someone who can't use the modules back to Finances", async () => {
    given({ member: false });
    await expect(removeSavings(form([["monthId", "m-sep"]]))).rejects.toThrow("REDIRECT:/finances");
  });
});
