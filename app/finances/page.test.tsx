// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import { REPO_ROOT, styleOf } from "../../test/css";
import { installDialogStandIn } from "../../test/dialog";
import { fakeSupabase } from "../../test/fake-supabase";
import FinancesPage from "./page";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

beforeAll(installDialogStandIn);
afterEach(cleanup);

const PEOPLE = [
  { user_id: "u-alex", name: "Alex", manages_budget: true },
  { user_id: "u-sam", name: "Sam", manages_budget: false },
];
const YEAR_2026 = {
  id: "y-2026",
  start_year: 2026,
  note: "",
  shares: [
    { user_id: "u-alex", percent: 60 },
    { user_id: "u-sam", percent: 40 },
  ],
};
const BILLS = [
  { id: "b-rent", name: "Rent", kind: "rent", due_day: 1 },
  { id: "b-card", name: "Joint card", kind: "card", due_day: 22 },
];

let fake: ReturnType<typeof fakeSupabase>;

function given({
  signedIn,
  permissions = [],
  budgetYear = null,
  bills = [],
}: {
  signedIn: boolean;
  permissions?: string[];
  budgetYear?: typeof YEAR_2026 | null;
  bills?: typeof BILLS;
}) {
  fake = fakeSupabase({
    signedIn,
    permissions,
    people: PEOPLE,
    tables: { budget_years: budgetYear ? [budgetYear] : [], bills },
  });
  vi.mocked(createClient).mockResolvedValue(
    fake as unknown as Awaited<ReturnType<typeof createClient>>,
  );
}

const ADMIN = ["use_modules", "manage_members", "manage_budget"];
const MEMBER = ["use_modules"];

describe("the Finances page", () => {
  it("sends a signed-out visitor to sign-in", async () => {
    given({ signedIn: false });
    await expect(FinancesPage()).rejects.toThrow("REDIRECT:/sign-in");
  });

  // REQ-50, first run (DESIGN.md §7): before a budget year exists the page
  // is one card; an admin gets Start setup.
  it("asks an admin to set up the budget year, with Start setup", async () => {
    given({ signedIn: true, permissions: ADMIN });
    render(await FinancesPage());
    const card = screen.getByRole("region", { name: "Set up your budget year" });
    const start = within(card).getByRole("link", { name: "Start setup" });
    expect(start.getAttribute("href")).toBe("/finances/budget-year");
    expect(screen.queryByRole("region", { name: "Bills" })).toBeNull();
  });

  it("tells a member which admin sets it up, with no button", async () => {
    given({ signedIn: true, permissions: MEMBER });
    render(await FinancesPage());
    const card = screen.getByRole("region", { name: "Set up your budget year" });
    expect(card.textContent).toContain(
      "Finances isn't set up yet. Alex, your admin, needs to set up the budget year.",
    );
    expect(within(card).queryByRole("link")).toBeNull();
  });

  it("names both admins plainly when there are two", async () => {
    given({ signedIn: true, permissions: MEMBER });
    fake.rpc.mockImplementation(async (fn: string) =>
      fn === "household_people"
        ? { data: PEOPLE.map((person) => ({ ...person, manages_budget: true })), error: null }
        : { data: false, error: null },
    );
    render(await FinancesPage());
    const card = screen.getByRole("region", { name: "Set up your budget year" });
    expect(card.textContent).toContain("Ask Alex or Sam to set up the budget year.");
  });

  // REQ-50: any month from April through the following March uses the
  // budget year named by that April.
  it.each([
    [new Date("2026-04-01T12:00:00Z"), 2026],
    [new Date("2027-03-31T12:00:00Z"), 2026],
    [new Date("2027-04-01T12:00:00Z"), 2027],
  ])("on %s reads the budget year starting in April %i", async (today, startYear) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(today);
    given({ signedIn: true, permissions: MEMBER, budgetYear: YEAR_2026 });
    render(await FinancesPage());
    vi.useRealTimers();
    const budgetYears = fake.from.mock.calls.findIndex(([table]) => table === "budget_years");
    const query = fake.from.mock.results[budgetYears].value;
    expect(query.eq).toHaveBeenCalledWith("start_year", startYear);
  });

  // REQ-94: every bill in the list is a row on Finances home, with its due
  // date. Nothing can be entered yet, so the month reads as incomplete.
  it("shows each bill as a row with its due date once the budget year exists", async () => {
    given({ signedIn: true, permissions: MEMBER, budgetYear: YEAR_2026, bills: BILLS });
    render(await FinancesPage());
    const bills = screen.getByRole("region", { name: "Bills" });
    expect(within(bills).getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      "RentDue the 1stNot entered",
      "Joint cardDue the 22ndNot entered",
    ]);
    expect(screen.getByText("Incomplete")).toBeDefined();
  });

  it("shows the year's split in the Admin block, locked for a member", async () => {
    given({ signedIn: true, permissions: MEMBER, budgetYear: YEAR_2026 });
    render(await FinancesPage());
    const admin = screen.getByRole("region", { name: "Admin" });
    expect(admin.textContent).toContain("April 2026 – March 2027 · Alex 60% · Sam 40%");
    expect(admin.textContent).toContain("Admin only");
    expect(within(admin).queryByRole("link")).toBeNull();
  });

  it("lets an admin open the budget year from the Admin block", async () => {
    given({ signedIn: true, permissions: ADMIN, budgetYear: YEAR_2026 });
    render(await FinancesPage());
    const admin = screen.getByRole("region", { name: "Admin" });
    expect(within(admin).getByRole("link", { name: "Open" }).getAttribute("href")).toBe(
      "/finances/budget-year",
    );
  });

  it("puts the module bar below the page, for phones", async () => {
    given({ signedIn: true });
    render(await FinancesPage());
    const phoneBar = screen.getByRole("main").nextElementSibling as HTMLElement;
    expect(within(phoneBar).getByRole("navigation", { name: "Finances navigation" })).toBeDefined();
  });

  it("marks Finances as where you are, in the desktop sidebar", async () => {
    given({ signedIn: true });
    render(await FinancesPage());
    const sidebar = screen.getByRole("navigation", { name: "Main" });
    const here = within(sidebar)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(here.map((link) => link.textContent)).toEqual(["Finances"]);
  });

  // REQ-17: the designed header (DESIGN.md §7).
  it("heads the page with the Finances icon and name, the month and its status", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 22, 9));
    given({ signedIn: true });
    await act(async () => render(await FinancesPage()));
    vi.useRealTimers();
    const header = screen.getByRole("main").querySelector("header")!;
    expect(header.querySelector("svg")).not.toBeNull();
    expect(within(header).getByRole("heading", { level: 1 }).textContent).toBe("Finances");
    const month = within(header).getByRole("button", { name: "September 2026" });
    expect((month as HTMLButtonElement).disabled).toBe(true);
    expect(within(header).getByText("No budget year")).toBeDefined();
  });

  it("shows the sections as tabs on a desktop, Overview first, Budget year locked", async () => {
    given({ signedIn: true });
    render(await FinancesPage());
    const tabs = screen.getByRole("navigation", { name: "Finances sections" });
    const items = within(tabs).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Overview",
      "Monthly entry",
      "Income",
      "Savings",
      "Balances",
      "History",
      "Budget yearAdmin only",
    ]);
    expect(within(tabs).getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(items[6].querySelector("svg")).not.toBeNull();
    const css = readFileSync(join(REPO_ROOT, "components/section-tabs.module.css"), "utf-8");
    expect(styleOf(css, "tabs", false).get("display")).toBe("none");
    expect(styleOf(css, "tabs", true).get("display")).toBe("block");
  });
});
