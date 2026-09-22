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

async function renderAs(permissions: string[], tables: FakeData["tables"] = {}) {
  vi.mocked(createClient).mockResolvedValue(
    fakeSupabase({ permissions, people: PEOPLE, tables }) as unknown as Awaited<
      ReturnType<typeof createClient>
    >,
  );
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-22T16:00:00Z"));
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
    const saved = within(section).getByRole("listitem");
    expect(add.compareDocumentPosition(saved) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(saved).getByText("Edit")).toBeDefined();
    expect(within(saved).getAllByRole("button").map((b) => b.textContent)).toContain("Remove");
  });

  // REQ-50 and #132: no year to pick; a split starts in a month you choose
  // and the one in force is marked.
  it("asks which month a split starts in, and marks the one in force", async () => {
    await renderAs(ADMIN, { splits: [SPLIT] });
    const split = screen.getByRole("region", { name: "Split" });
    expect(split.textContent).toContain("Your budget year runs April 2026 to March 2027.");
    expect(split.textContent).toContain("This month splits Alex 60% · Sam 40%.");
    const months = within(split).getByLabelText("Month the new split starts") as HTMLSelectElement;
    expect(months.value).toBe("2026-09");
    expect([months.options[0].textContent, months.options[23].textContent]).toEqual([
      "April 2026",
      "March 2028",
    ]);
    const saved = within(split).getByRole("listitem");
    expect(saved.textContent).toContain("From April 2026");
    expect(saved.textContent).toContain("In force");
    expect(saved.textContent).toContain("Alex 60% · Sam 40%");
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

  it("says plainly when no split covers this month", async () => {
    await renderAs(ADMIN);
    const split = screen.getByRole("region", { name: "Split" });
    expect(split.textContent).toContain("No split covers this month yet.");
    expect(split.textContent).toContain("Nothing saved yet.");
  });

  it("fills a split that hasn't started into its Edit form, with its month fixed", async () => {
    await renderAs(ADMIN, { splits: [LATER] });
    const saved = within(screen.getByRole("region", { name: "Split" })).getByRole("listitem");
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
    const saved = within(screen.getByRole("region", { name: "Split" })).getByRole("listitem");
    expect(saved.textContent).toContain("Already started, so it stays as it is.");
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
    expect(income.textContent).toContain("past paydays keep their amount");
    expect((within(saved).getByLabelText("Take-home per payment of Saturday shifts") as HTMLInputElement).value).toBe("2400");
  });

  it("falls back to the owner's name for a source saved without one", async () => {
    await renderAs(ADMIN, {
      income_sources: [
        { id: "i-0", name: "", owner_id: "u-alex", net_amount: 100, cadence: "monthly", anchor_date: "2026-09-01" },
      ],
    });
    const saved = within(screen.getByRole("region", { name: "Income sources" })).getByRole("listitem");
    expect(saved.textContent).toContain("Alex");
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
});
