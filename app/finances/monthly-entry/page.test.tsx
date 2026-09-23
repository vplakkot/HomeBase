// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../../lib/supabase/server";
import { installDialogStandIn } from "../../../test/dialog";
import { fakeSupabase } from "../../../test/fake-supabase";
import MonthlyEntryPage from "./page";

vi.mock("../../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/finances/monthly-entry",
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
const BILLS = [
  { id: "b-rent", name: "Rent", kind: "rent", due_day: 1 },
  { id: "b-card", name: "Joint card", kind: "card", due_day: 22 },
];
const SEPTEMBER = {
  id: "m-sep",
  starts_on: "2026-09-01",
  bills: [
    { id: "mb-card", name: "Joint card", kind: "card", due_day: 22, amount: "900.00", personal_answer: "some",
      personal_charges: [{ id: "c-1", owner_id: "u-sam", amount: "45.00", note: "Birthday gift" }] },
    { id: "mb-rent", name: "Rent", kind: "rent", due_day: 1, amount: null, personal_answer: null, personal_charges: [] },
  ],
  direct_payments: [{ id: "d-1", payer_id: "u-alex", amount: "64.20", note: "Groceries, Venmo" }],
};

function given({ months = [] as unknown[], bills = BILLS } = {}) {
  const fake = fakeSupabase({
    permissions: ["use_modules"],
    people: PEOPLE,
    tables: { months, bills },
  });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
}

const page = async (month?: string) => render(await MonthlyEntryPage({ searchParams: Promise.resolve({ month }) }));

describe("Monthly entry before the month is opened", () => {
  it("offers to open the month now running, copying in the bill list", async () => {
    given();
    await page();
    const card = screen.getByRole("region", { name: "September 2026" });
    expect(card.textContent).toContain("copies in the household's 2 bills");
    expect(card.textContent).toContain("apply from the next month opened");
    expect(within(card).getByRole("button", { name: "Open September 2026" })).toBeDefined();
    expect(screen.getByText("Incomplete")).toBeDefined();
  });
});

describe("Monthly entry in an opened month", () => {
  // REQ-53: every bill in the month gets an entry field.
  it("gives every bill in the month its own entry field, in due order", async () => {
    given({ months: [SEPTEMBER] });
    await page();
    const bills = screen.getByRole("region", { name: "Bills" });
    expect(within(bills).getByRole("textbox", { name: "Amount of Rent" })).toBeDefined();
    expect(within(bills).getByRole("textbox", { name: "Amount of Joint card" })).toBeDefined();
    const names = [...bills.querySelectorAll("li > div > span:first-child")].map((el) => el.textContent);
    expect(names.slice(0, 1)).toEqual(["Rent"]);
    expect(bills.textContent).toContain("Due 1 Sep");
  });

  // REQ-53: a bill not entered is shown, and the month is Incomplete.
  it("marks a bill not yet entered and the month as Incomplete", async () => {
    given({ months: [SEPTEMBER] });
    await page();
    expect(screen.getByRole("region", { name: "Bills" }).textContent).toContain("Not entered");
    expect(screen.getByText("Incomplete")).toBeDefined();
  });

  // REQ-54 and REQ-94: a card statement asks about personal charges, as a
  // required choice; rent never asks.
  it("asks about personal charges on a card statement, and not on rent", async () => {
    given({ months: [SEPTEMBER] });
    await page();
    const groups = screen.getAllByRole("group", { name: "Any personal charges still inside this balance?" });
    expect(groups).toHaveLength(1);
    const cardForm = screen.getByRole("textbox", { name: "Amount of Joint card" }).closest("form")!;
    const rentForm = screen.getByRole("textbox", { name: "Amount of Rent" }).closest("form")!;
    expect(within(cardForm).getAllByRole("radio")).toHaveLength(2);
    expect((within(cardForm).getByRole("radio", { name: /No/ }) as HTMLInputElement).required).toBe(true);
    expect(within(rentForm).queryAllByRole("radio")).toHaveLength(0);
  });

  // REQ-54: only charges still inside the balance are declared.
  it("says only charges still inside the balance count", async () => {
    given({ months: [SEPTEMBER] });
    await page();
    expect(
      screen.getByText(/Anything paid off before the statement closed stays out/),
    ).toBeDefined();
  });

  // REQ-54: an amount, whose, and an optional note.
  it("lists declared charges and asks for amount, whose and a note", async () => {
    given({ months: [SEPTEMBER] });
    await page();
    const charges = screen.getByRole("region", { name: "Personal charges on Joint card" });
    expect(charges.textContent).toContain("Sam$45.00Birthday gift");
    expect(within(charges).getByRole("textbox", { name: "Amount of a personal charge on Joint card" })).toBeDefined();
    expect(within(charges).getByRole("combobox", { name: "Whose personal charge on Joint card" })).toBeDefined();
    const note = within(charges).getByRole("textbox", { name: "Note for a personal charge on Joint card" });
    expect((note as HTMLInputElement).required).toBe(false);
  });

  // REQ-55: payer, total and note; and a card's spend isn't logged here.
  it("logs direct payments with payer, total and note, and points card spend at its statement", async () => {
    given({ months: [SEPTEMBER] });
    await page();
    const direct = screen.getByRole("region", { name: "Direct payments" });
    expect(direct.textContent).toContain("Anything on Joint card is already in its statement, so don't log it here.");
    expect(within(direct).getByRole("combobox", { name: "Who paid the direct payment" })).toBeDefined();
    expect(within(direct).getByRole("textbox", { name: "Total of the direct payment" })).toBeDefined();
    const note = within(direct).getByRole("textbox", { name: "What the direct payment was for" });
    expect((note as HTMLInputElement).required).toBe(true);
    expect(direct.textContent).toContain("Groceries, Venmo$64.20Paid by Alex");
  });

  // REQ-53: entry is shared. The page shows every entry whoever made it:
  // Sam's charge and Alex's payment are both on the page, whoever is signed in.
  it("shows entries made by either person", async () => {
    given({ months: [SEPTEMBER] });
    await page();
    expect(screen.getByText("Birthday gift")).toBeDefined();
    expect(screen.getByText("Paid by Alex")).toBeDefined();
  });

  it("reads Open once every bill is entered", async () => {
    given({
      months: [{ ...SEPTEMBER, bills: [{ ...SEPTEMBER.bills[1], amount: "2000.00" }, SEPTEMBER.bills[0]] }],
    });
    await page();
    expect(screen.getByText("Open")).toBeDefined();
  });
});
