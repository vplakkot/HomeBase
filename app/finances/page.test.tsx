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
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/finances",
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
const SPLIT = {
  id: "s-1",
  effective_from: "2026-04-01",
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
  split = null,
  bills = [],
}: {
  signedIn: boolean;
  permissions?: string[];
  split?: typeof SPLIT | null;
  bills?: typeof BILLS;
}) {
  fake = fakeSupabase({
    signedIn,
    permissions,
    people: PEOPLE,
    tables: { splits: split ? [split] : [], bills },
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

  // REQ-50, #132: the split in force is the latest one that had started
  // by today; a later one doesn't reach back.
  it("uses the split in force this month, not a later one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
    given({
      signedIn: true,
      permissions: MEMBER,
      split: SPLIT,
    });
    fake.from.mockImplementation((table: string) => {
      const rows =
        table === "splits"
          ? [
              { ...SPLIT, id: "s-2", effective_from: "2026-11-01", shares: [{ user_id: "u-alex", percent: 90 }, { user_id: "u-sam", percent: 10 }] },
              SPLIT,
            ]
          : [];
      const result = { data: rows, error: null };
      const query: Record<string, unknown> = {
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      };
      for (const method of ["select", "eq", "is", "order", "insert", "update", "delete"]) {
        query[method] = () => query;
      }
      return query;
    });
    render(await FinancesPage());
    vi.useRealTimers();
    const admin = screen.getByRole("region", { name: "Admin" });
    expect(admin.textContent).toContain("From April 2026 · Alex 60% · Sam 40%");
  });

  // REQ-94: every bill in the list is a row on Finances home, with its due
  // date. Nothing can be entered yet, so the month reads as incomplete.
  it("shows each bill as a row with its due date once the budget year exists", async () => {
    given({ signedIn: true, permissions: MEMBER, split: SPLIT, bills: BILLS });
    render(await FinancesPage());
    const bills = screen.getByRole("region", { name: "Bills" });
    expect(within(bills).getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      "RentDue the 1stNot entered",
      "Joint cardDue the 22ndNot entered",
    ]);
    expect(screen.getByText("Incomplete")).toBeDefined();
  });

  // REQ-94, REQ-53: once the month is opened its rows are the month's own
  // copy of the bills — a bill renamed since doesn't reach it — with the
  // amount entered, and Not entered for the rest.
  it("shows an opened month's own bills with their amounts", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-22T16:00:00Z"));
    fake = fakeSupabase({
      permissions: MEMBER,
      people: PEOPLE,
      tables: {
        splits: [SPLIT],
        bills: [{ id: "b-card", name: "Renamed card", kind: "card", due_day: 22 }],
        months: [
          {
            id: "m-sep",
            starts_on: "2026-09-01",
            bills: [
              { id: "mb-rent", name: "Rent", kind: "rent", due_day: 1, amount: "2000.00", personal_answer: null, personal_charges: [], payments: [] },
              { id: "mb-card", name: "Joint card", kind: "card", due_day: 22, amount: null, personal_answer: null, personal_charges: [], payments: [] },
            ],
            direct_payments: [],
          },
        ],
      },
    });
    vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
    render(await FinancesPage());
    vi.useRealTimers();
    const bills = screen.getByRole("region", { name: "Bills" });
    expect(within(bills).getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      "RentDue 1 Sep · $0.00 of $2,000.00$2,000.00 left",
      "Joint cardDue 22 SepNot entered",
    ]);
    expect(within(bills).getByRole("link", { name: "Enter bills" }).getAttribute("href")).toBe(
      "/finances/monthly-entry?month=2026-09",
    );
    expect(screen.getByText("Incomplete")).toBeDefined();
  });

  // REQ-56, 57, 58, 92: the month in focus shows each person's owed, paid
  // and outstanding, and each bill's paid of total and what's left. Alex
  // paid rent, Sam paid the Amazon card, and the joint card is still open.
  it("shows who owes what and what's left on each bill", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-22T16:00:00Z"));
    const bill = (id: string, name: string, due_day: number, amount: string, payments: unknown[]) => ({
      id, name, kind: "card", due_day, amount, personal_answer: "none", personal_charges: [], payments,
    });
    fake = fakeSupabase({
      permissions: MEMBER,
      people: PEOPLE,
      tables: {
        splits: [SPLIT],
        bills: [],
        months: [
          {
            id: "m-sep",
            starts_on: "2026-09-01",
            bills: [
              { ...bill("mb-rent", "Rent", 1, "2000.00", [{ id: "p-1", payer_id: "u-alex", amount: "2000.00", created_at: "2026-09-01" }]), kind: "rent", personal_answer: null },
              bill("mb-amazon", "Amazon card", 10, "400.00", [{ id: "p-2", payer_id: "u-sam", amount: "400.00", created_at: "2026-09-10" }]),
              bill("mb-joint", "Joint card", 22, "600.00", [{ id: "p-3", payer_id: "u-sam", amount: "150.00", created_at: "2026-09-12" }]),
            ],
            direct_payments: [{ id: "d-1", payer_id: "u-sam", amount: "100.00", note: "Taxi", paid_on: "2026-09-03" }],
          },
        ],
      },
    });
    vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
    render(await FinancesPage());
    vi.useRealTimers();

    // Shared: 3,000 of bills + 100 one-time = 3,100. Alex 60% = 1,860,
    // paid 2,000: a 140 credit. Sam 40% = 1,240, paid 400 + 150 + the
    // 100 taxi = 650, so 590 outstanding.
    const people = screen.getByRole("region", { name: "Who owes what" });
    expect(within(people).getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      "AlexPaid uppaid $2,000.00 of $1,860.00 · $140.00 credit",
      "Sam$590.00outstanding · paid $650.00 of $1,240.00",
    ]);
    expect(people.textContent).toContain("Shared$3,100.00");
    expect(people.textContent).toContain("Sam: 40% of $3,100.00 = $1,240.00 owed. Paid $650.00 ($100.00 of it in one-time payments).");

    const bills = screen.getByRole("region", { name: "Bills" });
    expect(bills.textContent).toContain("$450.00 of $3,000.00 left");
    expect(within(bills).getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      "RentDue 1 Sep · $2,000.00 of $2,000.00Paid",
      "Amazon cardDue 10 Sep · $400.00 of $400.00Paid",
      "Joint cardDue 22 Sep · $150.00 of $600.00$450.00 left",
    ]);
  });

  it("shows the year's split in the Admin block, locked for a member", async () => {
    given({ signedIn: true, permissions: MEMBER, split: SPLIT });
    render(await FinancesPage());
    const admin = screen.getByRole("region", { name: "Admin" });
    expect(admin.textContent).toContain("From April 2026 · Alex 60% · Sam 40%");
    expect(admin.textContent).toContain("Admin only");
    expect(within(admin).queryByRole("link")).toBeNull();
  });

  it("lets an admin open the budget year from the Admin block", async () => {
    given({ signedIn: true, permissions: ADMIN, split: SPLIT });
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
    // Only the month now running until another is opened, so nothing to choose.
    const month = within(header).getByRole("combobox", { name: "Month" }) as HTMLSelectElement;
    expect(month.selectedOptions[0].textContent).toBe("September 2026");
    expect(month.disabled).toBe(true);
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
      "Log payment",
    ]);
    expect(within(tabs).getByRole("link", { name: "Log payment" }).getAttribute("href")).toBe(
      "/finances/log-payment",
    );
    expect(within(tabs).getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(items[6].querySelector("svg")).not.toBeNull();
    const css = readFileSync(join(REPO_ROOT, "components/section-tabs.module.css"), "utf-8");
    expect(styleOf(css, "tabs", false).get("display")).toBe("none");
    expect(styleOf(css, "tabs", true).get("display")).toBe("block");
  });
});
