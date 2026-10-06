import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import { fakeSupabase } from "../../test/fake-supabase";
import { acknowledgeItem, closeMonthWithBalance, reopenMonth } from "./actions";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

let fake: ReturnType<typeof fakeSupabase>;

function given(permissions: string[]) {
  fake = fakeSupabase({ permissions });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
}

const form = () => {
  const data = new FormData();
  data.append("monthId", "m-sep");
  return data;
};

beforeEach(() => vi.clearAllMocks());

// REQ-59: only an admin closes a month with a balance.
describe("closeMonthWithBalance", () => {
  it("asks the database to close the month for an admin", async () => {
    given(["use_modules", "manage_budget"]);
    await expect(closeMonthWithBalance(form())).rejects.toThrow("REDIRECT:/finances");
    expect(fake.rpc).toHaveBeenCalledWith("close_month_with_balance", { p_month: "m-sep" });
  });

  it("sends a member back without closing anything", async () => {
    given(["use_modules"]);
    await expect(closeMonthWithBalance(form())).rejects.toThrow("REDIRECT:/finances");
    expect(fake.rpc).not.toHaveBeenCalledWith("close_month_with_balance", expect.anything());
  });
});

// Vin, 2026-10-06: an admin can reopen a closed month.
describe("reopenMonth", () => {
  const reopenForm = (month = "2026-04") => {
    const data = form();
    data.append("month", month);
    return data;
  };

  it("asks the database to reopen the month for an admin, then shows that month", async () => {
    given(["use_modules", "manage_budget"]);
    await expect(reopenMonth(reopenForm())).rejects.toThrow("REDIRECT:/finances?month=2026-04");
    expect(fake.rpc).toHaveBeenCalledWith("reopen_month", { p_month: "m-sep" });
  });

  it("sends a member back without reopening anything", async () => {
    given(["use_modules"]);
    await expect(reopenMonth(reopenForm())).rejects.toThrow("REDIRECT:/finances");
    expect(fake.rpc).not.toHaveBeenCalledWith("reopen_month", expect.anything());
  });

  it("only follows a month written like 2026-04", async () => {
    given(["use_modules", "manage_budget"]);
    await expect(reopenMonth(reopenForm("//evil"))).rejects.toThrow("REDIRECT:/finances");
  });

  it("says plainly when the database refuses", async () => {
    given(["use_modules", "manage_budget"]);
    const rpc = fake.rpc as unknown as ReturnType<typeof vi.fn>;
    rpc.mockImplementation(async (fn: string) =>
      fn === "reopen_month" ? { data: null, error: { message: "That month is not closed" } } : { data: true, error: null },
    );
    await expect(reopenMonth(reopenForm())).rejects.toThrow("Could not reopen the month: That month is not closed");
  });
});

// REQ-103: an item that's only news has its Acknowledge button on
// Finances home. Only the cash gap takes one.
describe("acknowledgeItem", () => {
  const keyed = (key: string) => {
    const data = new FormData();
    data.append("key", key);
    return data;
  };
  const upserts = () =>
    fake.from.mock.results.flatMap((result) => (result.value.upsert as ReturnType<typeof vi.fn>).mock.calls.map(([row]) => row));

  it("records that the viewer has seen a cash gap", async () => {
    given(["use_modules"]);
    await acknowledgeItem(keyed("cash-gap:2026-09-01"));
    expect(upserts()).toEqual([{ key: "cash-gap:2026-09-01" }]);
  });

  it("ignores any other key, so a task can't be ticked off by hand", async () => {
    given(["use_modules"]);
    await acknowledgeItem(keyed("enter:2026-09-01"));
    expect(fake.from).not.toHaveBeenCalled();
  });
});
