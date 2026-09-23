// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../../lib/supabase/server";
import { installDialogStandIn } from "../../../test/dialog";
import { fakeSupabase } from "../../../test/fake-supabase";
import LogPaymentPage from "./page";

vi.mock("../../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/finances/log-payment",
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

beforeAll(installDialogStandIn);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-22T16:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const PEOPLE = [
  { user_id: "u-alex", name: "Alex", manages_budget: true },
  { user_id: "u-sam", name: "Sam", manages_budget: false },
];
const SPLIT = {
  id: "s-1",
  effective_from: "2026-04-01",
  note: "",
  shares: [
    { user_id: "u-alex", percent: 60 },
    { user_id: "u-sam", percent: 40 },
  ],
};
const bill = (id: string, name: string, due_day: number, amount: string | null, payments: unknown[] = []) => ({
  id, name, kind: "rent", due_day, amount, personal_answer: null, personal_charges: [], payments,
});
const SEPTEMBER = {
  id: "m-sep",
  starts_on: "2026-09-01",
  bills: [
    bill("mb-rent", "Rent", 1, "2000.00", [{ id: "p-1", payer_id: "u-alex", amount: "2000.00", created_at: "2026-09-01" }]),
    bill("mb-joint", "Joint card", 22, "600.00", [{ id: "p-2", payer_id: "u-sam", amount: "150.00", created_at: "2026-09-12" }]),
    bill("mb-electric", "Electric", 25, null),
  ],
  direct_payments: [],
};

function given(months: unknown[] = [SEPTEMBER]) {
  const fake = fakeSupabase({
    permissions: ["use_modules"],
    people: PEOPLE,
    tables: { months, splits: [SPLIT] },
  });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
}

const page = async () => render(await LogPaymentPage({ searchParams: Promise.resolve({}) }));

describe("Log payment", () => {
  // REQ-57: who paid, how much, and toward which bill. Only bills with
  // something left are offered; one not entered yet can't be paid toward.
  it("asks who paid, the amount and the bill, offering only bills with something left", async () => {
    given();
    await page();
    const log = screen.getByRole("region", { name: "Log a payment" });
    const who = within(log).getByRole("group", { name: "Who paid" });
    expect(within(who).getAllByRole("radio").map((radio) => radio.parentElement?.textContent)).toEqual([
      "Alex",
      "Sam",
    ]);
    expect(within(log).getByRole("textbox", { name: "Amount of the payment" })).toBeDefined();
    const toward = within(log).getByRole("group", { name: "Toward" });
    expect(within(toward).getAllByRole("radio").map((radio) => radio.parentElement?.textContent)).toEqual([
      "Joint card$450.00 left",
    ]);
    // Alex's rent covers their $1,560 share; Sam owes $1,040 less $150.
    expect(log.textContent).toContain("Alex is paid up · Sam still owes $890.00");
  });

  // REQ-57: a mistake can be edited or deleted.
  it("lists the month's payments, each with Edit and Delete", async () => {
    given();
    await page();
    const list = screen.getByRole("region", { name: "Payments this month" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.firstElementChild?.textContent)).toEqual([
      "Alex → Rent$2,000.00",
      "Sam → Joint card$150.00",
    ]);
    expect(within(rows[0]).getByText("Edit")).toBeDefined();
    // Its own bill stays on offer while editing, even though Rent is paid in full.
    expect(within(rows[0]).getByRole("radio", { name: /^Rent/ })).toHaveProperty("checked", true);
    expect(within(rows[0]).getByRole("textbox", { name: "Amount of this payment" })).toHaveProperty(
      "value",
      "2000.00",
    );
    expect(within(rows[1]).getByRole("button", { name: "Delete Sam's $150.00 payment toward Joint card" })).toBeDefined();
  });

  it("points to Monthly entry when the month isn't open yet", async () => {
    given([]);
    await page();
    expect(screen.getByRole("link", { name: "Go to Monthly entry" }).getAttribute("href")).toBe(
      "/finances/monthly-entry?month=2026-09",
    );
  });

  // REQ-59: a closed month's payments are shown but can't change.
  it("offers nothing to change in a closed month", async () => {
    given([{ ...SEPTEMBER, closed_at: "2026-09-21T04:05:00Z", people: [] }]);
    await page();
    expect(screen.getByRole("region", { name: "Log a payment" }).textContent).toContain(
      "This month is closed, so its payments can't change.",
    );
    expect(within(screen.getByRole("main")).queryByRole("button")).toBeNull();
    expect(screen.queryByText("Edit")).toBeNull();
  });
});
