// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "../../../lib/supabase/server";
import { installDialogStandIn } from "../../../test/dialog";
import { fakeSupabase } from "../../../test/fake-supabase";
import BalancesPage from "./page";

vi.mock("../../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/finances/balances",
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

beforeAll(installDialogStandIn);
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
const paycheck = (owner_id: string, amount: string) => ({
  id: `i-${owner_id}`,
  owner_id,
  kind: "paycheck",
  amount,
  received_on: "2026-09-04",
  income_source_id: null,
  note: "",
});
// Rent 2,000 at 60/40: Alex has 2,500 − 1,200 = 1,300 left, Sam 1,000 − 800 = 200.
const SEPTEMBER = {
  id: "m-sep",
  starts_on: "2026-09-01",
  bills: [
    { id: "mb-rent", name: "Rent", kind: "rent", due_day: 1, amount: "2000.00", personal_answer: null, personal_charges: [], payments: [] },
  ],
  direct_payments: [],
  people: [],
  closed_at: null,
  income: [paycheck("u-alex", "2500.00"), paycheck("u-sam", "1000.00")],
  savings: [],
};
const bal = (month: string, user_id: string, account: string, amount: string) => ({ month, user_id, account, amount });

async function page(balances: unknown[], months: unknown[] = [SEPTEMBER]) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-24T16:00:00Z"));
  const fake = fakeSupabase({
    permissions: ["use_modules"],
    people: PEOPLE,
    tables: { months, splits: [SPLIT], balances },
  });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
  render(await BalancesPage({ searchParams: Promise.resolve({ month: "2026-09" }) }));
}

describe("Balances", () => {
  it("offers 401k, ESPP, RSU, investments and cash for each of us, last month's as a starting point (REQ-67)", async () => {
    await page([bal("2026-08-01", "u-alex", "401k", "12000.00"), bal("2026-08-01", "u-sam", "cash", "300.00")]);
    const enter = screen.getByRole("region", { name: "September 2026 balances" });
    for (const name of ["Alex", "Sam"]) {
      for (const account of ["401k", "ESPP", "RSU", "Investments", "Cash"]) {
        expect(within(enter).getByRole("textbox", { name: `${name}'s ${account}` })).toBeDefined();
      }
    }
    expect(within(enter).getByRole("textbox", { name: "Alex's 401k" })).toHaveProperty("value", "12000.00");
    expect(within(enter).getByRole("textbox", { name: "Sam's Cash" })).toHaveProperty("value", "300.00");
    expect(within(enter).getByRole("textbox", { name: "Alex's Cash" })).toHaveProperty("value", "");
    // Nothing is entered for September itself yet, so there's nothing to remove.
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
  });

  it("shows each month's total, its change and each account, with a skipped balance as not entered (REQ-67, REQ-68)", async () => {
    await page([
      bal("2026-08-01", "u-alex", "401k", "12000.00"),
      bal("2026-08-01", "u-sam", "cash", "300.00"),
      bal("2026-09-01", "u-alex", "401k", "12500.00"),
    ]);
    const trend = screen.getByRole("region", { name: "Trend" });
    const months = within(trend).getAllByRole("listitem").filter((row) => row.parentElement?.parentElement === trend.lastElementChild);
    expect(months.map((row) => row.firstElementChild?.textContent)).toEqual(["September 2026$12,500.00", "August 2026$12,300.00"]);
    expect(months[0].textContent).toContain("+$200.00 on the month before · 1 not entered");
    expect(months[0].textContent).toContain("Alex · 401k: $12,500.00 (+$500.00)");
    expect(months[0].textContent).toContain("Sam · Cash: not entered");
    expect(months[1].textContent).toContain("First month");
    // The chart (desktop only) draws the same totals.
    expect(screen.getByRole("img", { name: /Combined total from August 2026, \$12,300.00, to September 2026, \$12,500.00/ })).toBeDefined();
    const remove = screen.getByRole("button", { name: "Remove September 2026's balances" });
    expect(new FormData(remove.closest("form")!).get("month")).toBe("2026-09-01");
  });

  it("flags cash well above the leftover with a prompt, and skips anyone without cash entered (REQ-65)", async () => {
    await page([bal("2026-09-01", "u-alex", "cash", "1900.00")]);
    const check = screen.getByRole("region", { name: "Cash check" });
    const [alex, sam] = within(check).getAllByRole("listitem");
    expect(alex.textContent).toBe("Alex$600.00 extra$1,900.00 cash, $1,300.00 left. Move it to savings, or note where it came from.");
    expect(sam.textContent).toBe("Sam: no cash entered, so no check.");
  });

  it("shows a small gap without flagging it", async () => {
    await page([bal("2026-09-01", "u-sam", "cash", "450.00")]);
    const check = screen.getByRole("region", { name: "Cash check" });
    expect(within(check).getAllByRole("listitem")[1].textContent).toBe("Sam: $450.00 cash, $200.00 left ($250.00 over).");
  });

  it("skips the check before there's a leftover, without blocking entry", async () => {
    await page([bal("2026-09-01", "u-sam", "cash", "450.00")], [{ ...SEPTEMBER, income: [] }]);
    const check = screen.getByRole("region", { name: "Cash check" });
    expect(within(check).getAllByRole("listitem")[1].textContent).toBe("Sam: no leftover yet, so no check.");
    expect(screen.getByRole("button", { name: "Save Sam's balances" })).toBeDefined();
  });
});
