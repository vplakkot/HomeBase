// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "../../../lib/supabase/server";
import { installDialogStandIn } from "../../../test/dialog";
import { fakeSupabase } from "../../../test/fake-supabase";
import SavingsPage from "./page";

vi.mock("../../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/finances/savings",
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
// Rent 2,000 at 60/40: Alex owes 1,200 and Sam 800.
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
const CLOSED = {
  ...SEPTEMBER,
  closed_at: "2026-09-30T14:00:00Z",
  split_from: "2026-04-01",
  people: [
    { user_id: "u-alex", percent: "60.00", outstanding: "0.00" },
    { user_id: "u-sam", percent: "40.00", outstanding: "0.00" },
  ],
};

async function page(months: unknown[], today = "2026-09-22T16:00:00Z") {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(today));
  const fake = fakeSupabase({
    permissions: ["use_modules"],
    people: PEOPLE,
    tables: { months, splits: [SPLIT] },
  });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
  render(await SavingsPage({ searchParams: Promise.resolve({ month: "2026-09" }) }));
}

describe("Savings", () => {
  it("shows what each person puts into joint and what's theirs (REQ-63)", async () => {
    await page([SEPTEMBER]);
    const available = screen.getByRole("region", { name: "Available to save" });
    expect(within(available).getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      "Alex$100.00 to joint$1,200.00 yours",
      "Sam$100.00 to joint$100.00 yours",
    ]);
  });

  it("says in words when there's nothing to save (REQ-64)", async () => {
    await page([{ ...SEPTEMBER, income: [paycheck("u-alex", "2500.00"), paycheck("u-sam", "700.00")] }]);
    const available = screen.getByRole("region", { name: "Available to save" });
    expect(available.textContent).toContain(
      "Nothing to save this monthSam's income didn't cover their share: $100.00 came out of savings.",
    );
  });

  it("records what each person put into joint and saved on their own (REQ-66)", async () => {
    await page([{ ...SEPTEMBER, savings: [{ user_id: "u-sam", to_joint: "100.00", own: "0.00" }] }]);
    const saved = screen.getByRole("region", { name: "What you saved" });
    expect(within(saved).getByRole("textbox", { name: "Alex put into joint" })).toHaveProperty("value", "");
    expect(within(saved).getByRole("textbox", { name: "Sam put into joint" })).toHaveProperty("value", "100.00");
    expect(within(saved).getByRole("textbox", { name: "Sam saved on their own" })).toHaveProperty("value", "");
    expect(within(saved).getByRole("button", { name: "Save" })).toBeDefined();
  });

  it("sets a closed month's recorded savings beside what was available, and says where they differ", async () => {
    await page(
      [{ ...CLOSED, savings: [{ user_id: "u-alex", to_joint: "100.00", own: "1200.00" }, { user_id: "u-sam", to_joint: "60.00", own: "0.00" }] }],
      "2026-10-05T16:00:00Z",
    );
    const closed = screen.getByRole("region", { name: "Closed months" });
    const [row] = within(closed).getAllByRole("listitem");
    expect(row.textContent).toContain("September 2026$160.00 of $200.00 to joint");
    // Alex did as the app said, so no "differs".
    expect(row.textContent).toContain(
      "Alex: $100.00 of $100.00 into joint · $1,200.00 of $1,200.00 saved on their ownSam:",
    );
    expect(row.textContent).toContain(
      "Sam: $60.00 of $100.00 into joint · $0.00 of $100.00 saved on their own · differs",
    );
    // Recording stays open after the month closes: saving happens later.
    expect(screen.getByRole("button", { name: "Save" })).toBeDefined();
  });

  it("says a closed month with nothing recorded is not recorded", async () => {
    await page([CLOSED], "2026-10-05T16:00:00Z");
    const closed = screen.getByRole("region", { name: "Closed months" });
    expect(within(closed).getByRole("listitem").textContent).toBe("September 2026Not recorded");
  });

  it("points to Income when nothing is logged yet", async () => {
    await page([{ ...SEPTEMBER, income: [] }]);
    expect(screen.getByRole("link", { name: "Log income" }).getAttribute("href")).toBe("/finances/income?month=2026-09");
  });
});
