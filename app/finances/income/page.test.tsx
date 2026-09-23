// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "../../../lib/supabase/server";
import { installDialogStandIn } from "../../../test/dialog";
import { fakeSupabase } from "../../../test/fake-supabase";
import IncomePage from "./page";

vi.mock("../../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/finances/income",
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
const SOURCE = {
  id: "src-alex",
  name: "Acme pay",
  owner_id: "u-alex",
  net_amount: "2500.00",
  cadence: "biweekly",
  anchor_date: "2026-09-04",
  effective_from: "2026-01-01",
  ended_on: null,
};
const SEPTEMBER = {
  id: "m-sep",
  starts_on: "2026-09-01",
  bills: [],
  direct_payments: [],
  people: [],
  closed_at: null,
  income: [
    { id: "i-1", owner_id: "u-alex", kind: "paycheck", amount: "2500.00", received_on: "2026-09-04", income_source_id: "src-alex", note: "Acme pay" },
    { id: "i-2", owner_id: "u-sam", kind: "rsu", amount: "3100.00", received_on: "2026-09-12", income_source_id: null, note: "" },
  ],
};

async function page(months: unknown[], today = "2026-09-22T16:00:00Z") {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(today));
  const fake = fakeSupabase({
    permissions: ["use_modules"],
    people: PEOPLE,
    tables: { months, splits: [], income_sources: [SOURCE] },
  });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
  render(await IncomePage({ searchParams: Promise.resolve({ month: "2026-09" }) }));
}

describe("Income (REQ-60)", () => {
  it("pre-fills the paychecks the income setup expects, to confirm rather than type", async () => {
    await page([SEPTEMBER]);
    const expected = screen.getByRole("region", { name: "Paychecks to confirm" });
    // 4 Sep is already confirmed; 18 Sep is still to do.
    const rows = within(expected).getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector("p")?.textContent)).toEqual(["18 Sep"]);
    expect(within(rows[0]).getByRole("textbox", { name: "Amount of Acme pay on 2026-09-18" })).toHaveProperty(
      "value",
      "2500.00",
    );
    expect(within(rows[0]).getByRole("button", { name: "Confirm" })).toBeDefined();
  });

  it("logs any other income by kind, owner and amount", async () => {
    await page([SEPTEMBER]);
    const received = screen.getByRole("region", { name: "Received this month" });
    const kinds = within(received).getByRole("combobox", { name: "Kind of income" });
    expect(within(kinds).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Paycheck",
      "ESPP sale",
      "RSU sale",
      "Bonus",
      "Other",
    ]);
    expect(within(received).getByRole("combobox", { name: "Whose income it is" })).toBeDefined();
    expect(within(received).getByRole("textbox", { name: "Amount of the income" })).toBeDefined();
    expect(within(received).getAllByRole("listitem").slice(1).map((row) => row.firstElementChild?.textContent)).toEqual([
      "Alex · Paycheck$2,500.00",
      "Sam · RSU sale$3,100.00",
    ]);
  });

  it("says shares kept aren't income", async () => {
    await page([SEPTEMBER]);
    const received = screen.getByRole("region", { name: "Received this month" });
    expect(within(received).getByRole("note").getAttribute("aria-label")).toContain(
      "ESPP or RSU shares you kept aren't income; they belong in balances.",
    );
  });

  it("stays open in a month that squared and closed early, until the month is over", async () => {
    const closed = { ...SEPTEMBER, closed_at: "2026-09-20T04:05:00Z" };
    await page([closed]);
    expect(screen.getByRole("button", { name: "Log income" })).toBeDefined();
    cleanup();
    await page([closed], "2026-10-02T16:00:00Z");
    const received = screen.getByRole("region", { name: "Received this month" });
    expect(within(received).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("region", { name: "Paychecks to confirm" })).toBeNull();
  });

  it("points to Monthly entry when the month isn't open yet", async () => {
    await page([]);
    expect(screen.getByRole("link", { name: "Go to Monthly entry" })).toBeDefined();
  });
});
