// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "../../../lib/supabase/server";
import { installDialogStandIn } from "../../../test/dialog";
import { fakeSupabase, type FakeData } from "../../../test/fake-supabase";
import { REPO_ROOT, styleOf } from "../../../test/css";
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
const SPLIT = {
  id: "s-1",
  effective_from: "2026-04-01",
  note: "Salaries as of March",
  shares: [
    { user_id: "u-alex", percent: 60 },
    { user_id: "u-sam", percent: 40 },
  ],
};
// One that hasn't started yet, so it can still be changed.
const LATER = { ...SPLIT, id: "s-2", effective_from: "2026-11-01" };

async function renderAs(permissions: string[], tables: FakeData["tables"] = {}, today = "2026-09-22T16:00:00Z") {
  vi.mocked(createClient).mockResolvedValue(
    fakeSupabase({ permissions, people: PEOPLE, tables }) as unknown as Awaited<
      ReturnType<typeof createClient>
    >,
  );
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(today));
  await act(async () => render(await BudgetYearPage()));
  vi.useRealTimers();
}

describe("the Budget year section", () => {
  // DESIGN.md §10: text on a loud tile has to clear 4.5 to 1, so a chip
  // sitting on one is solid rather than see-through white.
  it("keeps chips on a loud tile solid, for contrast", () => {
    const css = readFileSync(join(REPO_ROOT, "app/finances/budget-year/page.module.css"), "utf-8");
    const chip = styleOf(css, "chip", false);
    expect(chip.get("background")).toBe("var(--color-surface)");
    expect(chip.get("color")).toBe("var(--module-loud)");
    const entry = styleOf(css, "entry", false);
    expect(entry.get("background")).toBe("var(--module-loud)");
    expect(entry.get("color")).toBe("var(--module-on-loud)");
  });

  // A hint only a mouse can reach isn't a hint (#133).
  it("shows a card's hint on keyboard focus, not only on hover", () => {
    const css = readFileSync(join(REPO_ROOT, "app/finances/budget-year/page.module.css"), "utf-8");
    expect(css).toMatch(/\.info:hover::after,\s*\.info:focus-visible::after \{\s*display: block;/);
    expect(css).toMatch(/content: attr\(data-hint\)/);
  });

  describe("the March review (REQ-69)", () => {
    const rent = (amount: string) => ({ id: `mb-${amount}`, name: "Rent", kind: "rent", due_day: 1, amount, personal_answer: null, personal_charges: [], payments: [] });
    const month = (starts_on: string, amount: string, closed = false) => ({
      id: `m-${starts_on}`,
      starts_on,
      bills: [rent(amount)],
      direct_payments: [],
      income: [],
      savings: [],
      closed_at: closed ? "2026-05-01T04:00:00Z" : null,
      people: closed ? [{ user_id: "u-alex", percent: "60", outstanding: "0" }, { user_id: "u-sam", percent: "40", outstanding: "0" }] : [],
    });
    const INCOME = [
      { id: "i-alex", name: "Paycheck", owner_id: "u-alex", net_amount: "3000.00", cadence: "biweekly", anchor_date: "2026-09-11", ended_on: null },
      { id: "i-sam", name: "Salary", owner_id: "u-sam", net_amount: "4000.00", cadence: "monthly", anchor_date: "2026-09-18", ended_on: null },
    ];

    it("in March, shows annualised income, the year's spend, and a split form starting in April", async () => {
      // The fake answers every months query with every row; the page reads one.
      await renderAs(ADMIN, { splits: [SPLIT], income_sources: INCOME, months: [month("2026-04-01", "2000.00", true)] }, "2027-03-10T16:00:00Z");
      const review = screen.getByRole("region", { name: "Split for April 2027" });
      expect(review.textContent).toContain("Alex$78,000.00 a year61.9% of both incomes");
      expect(review.textContent).toContain("Sam$48,000.00 a year38.1% of both incomes");
      expect(review.textContent).toContain("Household spend$2,000.00This budget year, over 1 month");
      // Starts in April, pre-filled with the split now in force. A split
      // only ever applies from its own month, and closed months keep
      // their own copy (month_people), so they're untouched.
      const form = within(review).getByRole("combobox", { name: "Month the new split starts" }).closest("form")!;
      expect(new FormData(form).get("effectiveFrom")).toBe("2027-04");
      expect(within(review).getByRole("textbox", { name: /Alex/ })).toHaveProperty("value", "60");
    });

    it("isn't there outside March, or once April's split is saved", async () => {
      await renderAs(ADMIN, { splits: [SPLIT] }, "2027-02-10T16:00:00Z");
      expect(screen.queryByRole("region", { name: /^Split for/ })).toBeNull();
      cleanup();
      await renderAs(ADMIN, { splits: [SPLIT, { ...SPLIT, id: "s-apr", effective_from: "2027-04-01" }] }, "2027-03-10T16:00:00Z");
      expect(screen.queryByRole("region", { name: /^Split for/ })).toBeNull();
    });
  });

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
    expect(within(tabs).getByRole("link", { name: /Budget year/ }).getAttribute("aria-current")).toBe("page");
    expect(within(tabs).getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBeNull();
  });

  // #132: the three cards are the same shape — a head, the add form, then
  // what's saved — so the page reads as one thing.
  it.each([
    ["Split", "Add a split"],
    ["Income sources", "Add an income source"],
    ["Bills", "Add a bill"],
  ])("gives %s a head, an %s block first, then what's saved", async (card, addTitle) => {
    await renderAs(ADMIN, {
      splits: [LATER],
      income_sources: [
        { id: "i-1", name: "Day job", owner_id: "u-sam", net_amount: 2400, cadence: "biweekly", anchor_date: "2026-09-18" },
      ],
      bills: [{ id: "b-1", name: "Rent", kind: "rent", due_day: 1 }],
    });
    const section = screen.getByRole("region", { name: card });
    const add = within(section).getByRole("heading", { name: addTitle, level: 3 });
    // A split tile holds a list of its own, so take the outer one.
    const [saved] = within(section).getAllByRole("listitem");
    expect(add.compareDocumentPosition(saved) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(saved).getByText("Edit")).toBeDefined();
    expect(within(saved).getAllByRole("button").map((b) => b.textContent)).toContain("Remove");
  });

  // REQ-50 and #132: no year to pick; a split starts in a month you choose
  // and the one in force is marked.
  it("asks which month a split starts in, and marks the one in force", async () => {
    await renderAs(ADMIN, { splits: [SPLIT] });
    const split = screen.getByRole("region", { name: "Split" });
    // The explanation is a short hint on the head's icon, not a
    // paragraph, and it doesn't repeat what the in-force tile shows (#133).
    const hint = within(split).getByRole("note");
    expect(hint.getAttribute("title")).toBe(
      "How you divide shared costs. It applies from the month you pick onwards.",
    );
    expect(hint.getAttribute("data-hint")).toBe(hint.getAttribute("title"));
    expect(split.textContent).not.toContain("Your budget year runs");
    const months = within(split).getByLabelText("Month the new split starts") as HTMLSelectElement;
    expect(months.value).toBe("2026-09");
    // This month onwards: a month already gone can't be saved anyway.
    expect([months.options[0].textContent, months.options[23].textContent]).toEqual([
      "September 2026",
      "August 2028",
    ]);
    const [saved] = within(split).getAllByRole("listitem");
    expect(saved.textContent).toContain("From April 2026");
    expect(saved.textContent).toContain("In force");
    expect(saved.textContent).toContain("Alex60%");
  });

  it("keeps a running total and says when it isn't 100", async () => {
    await renderAs(ADMIN);
    const split = screen.getByRole("region", { name: "Split" });
    fireEvent.change(within(split).getByLabelText("Alex's share of the new split"), { target: { value: "60" } });
    fireEvent.change(within(split).getByLabelText("Sam's share of the new split"), { target: { value: "30" } });
    expect(within(split).getByText("Total: 90% · must be 100%")).toBeDefined();
    fireEvent.change(within(split).getByLabelText("Sam's share of the new split"), { target: { value: "40" } });
    expect(within(split).getByText("Total: 100%")).toBeDefined();
  });

  it("says plainly when nothing is saved yet", async () => {
    await renderAs(ADMIN);
    expect(screen.getByRole("region", { name: "Split" }).textContent).toContain("Nothing saved yet.");
  });

  // #133: the cards run Income sources, Bills, then Split, which changes
  // about once a year.
  it("puts the split last, after income sources and bills", async () => {
    await renderAs(ADMIN);
    const cards = screen.getAllByRole("region").map((card) => card.getAttribute("aria-labelledby"));
    expect(cards).toEqual(["add-an-income-source", "add-a-bill", "add-a-split"]);
  });

  it("fills a split that hasn't started into its Edit form, with its month fixed", async () => {
    await renderAs(ADMIN, { splits: [LATER] });
    const [saved] = within(screen.getByRole("region", { name: "Split" })).getAllByRole("listitem");
    const what = "the split from November 2026";
    expect((within(saved).getByLabelText(`Alex's share of ${what}`) as HTMLInputElement).value).toBe("60");
    expect((within(saved).getByLabelText(`What ${what} is based on`) as HTMLTextAreaElement).value).toBe(
      "Salaries as of March",
    );
    // The month can't be moved from here, so editing can't strand a split.
    expect(within(saved).queryByLabelText(`Month ${what} starts`)).toBeNull();
    expect(saved.textContent).toContain("In force from November 2026");
  });

  // #132: a split that has begun is what its months ran on.
  it("won't offer to edit or remove a split that has already started", async () => {
    await renderAs(ADMIN, { splits: [SPLIT] });
    const [saved] = within(screen.getByRole("region", { name: "Split" })).getAllByRole("listitem");
    // Month, chip, then a person per line with the percentage sized
    // like an income amount (#135).
    expect(saved.textContent).toBe("From April 2026In forceAlex60%Sam40%");
    expect(within(saved).getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      "Alex60%",
      "Sam40%",
    ]);
    expect(within(saved).queryByText("Edit")).toBeNull();
    expect(within(saved).queryByRole("button", { name: /Remove/ })).toBeNull();
  });

  // REQ-51 and #132: one line of detail, and Edit prefilled.
  it("shows an income source in two lines and offers to edit it", async () => {
    await renderAs(ADMIN, {
      income_sources: [
        { id: "i-1", name: "Saturday shifts", owner_id: "u-sam", net_amount: 2400, cadence: "biweekly", anchor_date: "2026-09-18" },
      ],
    });
    const income = screen.getByRole("region", { name: "Income sources" });
    const saved = within(income).getByRole("listitem");
    expect(saved.textContent).toContain("Saturday shifts");
    expect(saved.textContent).toContain("$2,400.00");
    expect(saved.textContent).toContain("Sam · Every two weeks · next Oct 2");
    expect(within(income).getByRole("note").getAttribute("title")).toBe(
      "What lands, and when. Editing one changes it from today; past paydays keep their amount.",
    );
    expect((within(saved).getByLabelText("Take-home per payment of Saturday shifts") as HTMLInputElement).value).toBe("2400");
  });

  it("falls back to the owner's name for a source saved without one", async () => {
    await renderAs(ADMIN, {
      income_sources: [
        { id: "i-0", name: "", owner_id: "u-alex", net_amount: 100, cadence: "monthly", anchor_date: "2026-09-01" },
      ],
    });
    const saved = within(screen.getByRole("region", { name: "Income sources" })).getByRole("listitem");
    // The owner stands in as the title, so it isn't said twice (#135).
    expect(saved.textContent).toContain("Alex");
    expect(saved.textContent).not.toContain("Alex · Every month");
    expect(saved.textContent).toContain("Every month · next");
    expect(within(saved).getByRole("button", { name: "Remove income source" })).toBeDefined();
  });

  // REQ-94: type chip, due day in words, and the day picked from a list.
  it("shows a bill with its type and due day, and picks the day from ordinals", async () => {
    await renderAs(ADMIN, { bills: [{ id: "b-1", name: "Chase Visa", kind: "card", due_day: 28 }] });
    const bills = screen.getByRole("region", { name: "Bills" });
    const saved = within(bills).getByRole("listitem");
    expect(saved.textContent).toContain("Chase Visa");
    expect(saved.textContent).toContain("Due the 28th of each month");
    // The type reads as a chip beside the name, not as raw data.
    expect(within(saved).getAllByText("Card")[0].className).toContain("chip");
    const days = within(bills).getByLabelText("Due day of new bill") as HTMLSelectElement;
    expect(days.options.length).toBe(31);
    expect([days.options[0].textContent, days.options[21].textContent]).toEqual(["1st", "22nd"]);
    const types = within(bills).getByLabelText("Type of new bill") as HTMLSelectElement;
    expect([...types.options].map((option) => option.textContent)).toEqual(["Rent", "Card", "Other"]);
  });

  // Vin, 2026-09-23: with a month open, Remove carries a tick box, and it
  // squeezed an opened Edit form to a sliver. An open form takes the row.
  it("gives an opened edit form the whole row", () => {
    const css = readFileSync(join(REPO_ROOT, "app/finances/budget-year/page.module.css"), "utf-8");
    expect(styleOf(css, "actions", false).get("flex-wrap")).toBe("wrap");
    expect(css).toMatch(/\.change\[open\] \{\s*flex-basis: 100%;/);
  });

  // Vin, 2026-09-23: rent is the same every month, so a rent bill carries
  // its amount. Only rent asks for it.
  it("asks a rent bill for its monthly amount, and shows it in the list", async () => {
    await renderAs(ADMIN, {
      bills: [{ id: "b-1", name: "Rent", kind: "rent", due_day: 1, amount: "1850.00" }],
    });
    const bills = screen.getByRole("region", { name: "Bills" });
    expect(within(bills).getByRole("listitem").textContent).toContain("$1,850.00 · Due the 1st of each month");
    expect(within(bills).queryByLabelText("Monthly amount of new bill")).toBeNull();
    fireEvent.change(within(bills).getByLabelText("Type of new bill"), { target: { value: "rent" } });
    const amount = within(bills).getByLabelText("Monthly amount of new bill") as HTMLInputElement;
    expect(amount.required).toBe(true);
    expect((within(bills).getByLabelText("Monthly amount of Rent") as HTMLInputElement).defaultValue).toBe("1850.00");
  });

  // REQ-94, revised 2026-09-23: while this month is open, adding,
  // changing or removing a bill asks whether the month takes it too.
  it("asks whether an open month takes a bill change, ticked by default", async () => {
    await renderAs(ADMIN, {
      bills: [{ id: "b-1", name: "Chase Visa", kind: "card", due_day: 28 }],
      months: [{ starts_on: "2026-09-01" }],
    });
    const bills = screen.getByRole("region", { name: "Bills" });
    for (const name of [
      "Also apply the new bill to September 2026",
      "Also apply the change to Chase Visa to September 2026",
      "Also set Chase Visa to $0 in September 2026 if not entered yet",
    ]) {
      expect((within(bills).getByRole("checkbox", { name }) as HTMLInputElement).checked).toBe(true);
    }
    expect(bills.textContent).toContain("$0 if not entered yet");
  });

  it("doesn't ask while no month is open", async () => {
    await renderAs(ADMIN, { bills: [{ id: "b-1", name: "Chase Visa", kind: "card", due_day: 28 }] });
    expect(within(screen.getByRole("region", { name: "Bills" })).queryAllByRole("checkbox")).toHaveLength(0);
  });
});
