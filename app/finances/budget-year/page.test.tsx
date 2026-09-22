// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "../../../lib/supabase/server";
import { installDialogStandIn } from "../../../test/dialog";
import { fakeSupabase, type FakeData } from "../../../test/fake-supabase";
import BudgetYearPage from "./page";

vi.mock("../../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

beforeAll(installDialogStandIn);
afterEach(cleanup);

const ADMIN = ["use_modules", "manage_members", "manage_budget"];
const PEOPLE = [
  { user_id: "u-alex", name: "Alex", manages_budget: true },
  { user_id: "u-sam", name: "Sam", manages_budget: false },
];

async function renderAs(permissions: string[], tables: FakeData["tables"] = {}) {
  vi.mocked(createClient).mockResolvedValue(
    fakeSupabase({ permissions, people: PEOPLE, tables }) as unknown as Awaited<
      ReturnType<typeof createClient>
    >,
  );
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-22T12:00:00Z"));
  await act(async () => render(await BudgetYearPage()));
  vi.useRealTimers();
}

describe("the Budget year section", () => {
  it("is locked for a member: Admin only, no forms", async () => {
    await renderAs(["use_modules"]);
    const main = screen.getByRole("main");
    expect(within(main).getByRole("region", { name: "Budget year" }).textContent).toContain("Admin only");
    expect(within(main).queryByRole("textbox")).toBeNull();
    expect(within(main).queryByRole("button")).toBeNull();
  });

  it("marks itself as where you are in the section tabs", async () => {
    await renderAs(ADMIN);
    const tabs = screen.getByRole("navigation", { name: "Finances sections" });
    const here = within(tabs).getByRole("link", { name: /Budget year/ });
    expect(here.getAttribute("aria-current")).toBe("page");
    expect(within(tabs).getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBeNull();
  });

  // REQ-50, #128: the year comes from the calendar, never from a field.
  it("works the budget year out from today and doesn't ask for it", async () => {
    await renderAs(ADMIN);
    const split = screen.getByRole("region", { name: "Split" });
    expect(split.textContent).toContain("Your budget year runs April 2026 to March 2027.");
    expect(within(split).queryByLabelText(/Budget year starting/)).toBeNull();
    expect(within(split).getByLabelText("Alex's share")).toBeDefined();
    expect(within(split).getByLabelText("Sam's share")).toBeDefined();
    expect(within(split).getByLabelText("Based on (optional)")).toBeDefined();
  });

  it("keeps a running total and says when it isn't 100", async () => {
    await renderAs(ADMIN);
    const split = screen.getByRole("region", { name: "Split" });
    fireEvent.change(within(split).getByLabelText("Alex's share"), { target: { value: "60" } });
    fireEvent.change(within(split).getByLabelText("Sam's share"), { target: { value: "30" } });
    expect(within(split).getByText("Total: 90% · must be 100%")).toBeDefined();
    fireEvent.change(within(split).getByLabelText("Sam's share"), { target: { value: "40" } });
    expect(within(split).getByText("Total: 100%")).toBeDefined();
  });

  it("fills in the saved split for the current budget year", async () => {
    await renderAs(ADMIN, {
      budget_years: [
        {
          id: "y",
          start_year: 2026,
          note: "Salaries as of March",
          shares: [
            { user_id: "u-alex", percent: 55 },
            { user_id: "u-sam", percent: 45 },
          ],
        },
      ],
    });
    const split = screen.getByRole("region", { name: "Split" });
    expect((within(split).getByLabelText("Alex's share") as HTMLInputElement).value).toBe("55");
    expect((within(split).getByLabelText("Based on (optional)") as HTMLTextAreaElement).value).toBe(
      "Salaries as of March",
    );
  });

  // REQ-51 and #128: a name tells two jobs apart, and the add form stays
  // at the top however many sources are saved.
  it("names each income source, lists its next paydays, and asks for all five facts", async () => {
    await renderAs(ADMIN, {
      income_sources: [
        {
          id: "i-1",
          name: "Saturday shifts",
          owner_id: "u-sam",
          net_amount: 2400,
          cadence: "biweekly",
          anchor_date: "2026-09-18",
        },
      ],
    });
    const income = screen.getByRole("region", { name: "Income sources" });
    expect(within(income).getByRole("listitem").textContent).toBe(
      "Saturday shifts$2,400.00Sam · Every two weeksNext paydays Oct 2, Oct 16, Oct 30Remove",
    );
    for (const label of ["Name", "Whose pay", "Take-home per payment", "How often", "One real payday"]) {
      expect(within(income).getByLabelText(label)).toBeDefined();
    }
    const [addFirst] = within(income).getAllByRole("button");
    expect(addFirst.textContent).toBe("Add income source");
  });

  // REQ-94 and #128: add at the top, saved bills below as rows, editing
  // folded away, and the due day picked from days of the month.
  it("adds at the top and lists saved bills below, with editing folded away", async () => {
    await renderAs(ADMIN, { bills: [{ id: "b-1", name: "Rent", kind: "rent", due_day: 1 }] });
    const bills = screen.getByRole("region", { name: "Bills" });
    const [addFirst] = within(bills).getAllByRole("button");
    expect(addFirst.textContent).toBe("Add bill");
    const row = within(bills).getByRole("listitem");
    expect(row.textContent).toContain("Rent");
    expect(row.textContent).toContain("Due the 1st of each month");
    expect(within(row).getByText("Change")).toBeDefined();
    expect((within(row).getByLabelText("Name of Rent") as HTMLInputElement).value).toBe("Rent");
    expect(within(row).getByRole("button", { name: "Remove Rent" })).toBeDefined();
  });

  it("picks the due day from the days of a month, as ordinals", async () => {
    await renderAs(ADMIN);
    const days = screen.getByLabelText("Due day of new bill") as HTMLSelectElement;
    expect(days.options.length).toBe(31);
    expect([days.options[0].textContent, days.options[21].textContent, days.options[30].textContent]).toEqual([
      "1st",
      "22nd",
      "31st",
    ]);
  });
});
