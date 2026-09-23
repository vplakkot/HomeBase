import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import { fakeSupabase } from "../../test/fake-supabase";
import { closeMonthWithBalance } from "./actions";

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
    await closeMonthWithBalance(form());
    expect(fake.rpc).toHaveBeenCalledWith("close_month_with_balance", { p_month: "m-sep" });
  });

  it("sends a member back without closing anything", async () => {
    given(["use_modules"]);
    await expect(closeMonthWithBalance(form())).rejects.toThrow("REDIRECT:/finances");
    expect(fake.rpc).not.toHaveBeenCalledWith("close_month_with_balance", expect.anything());
  });
});
