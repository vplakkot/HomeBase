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

  // Vin, 2026-09-23: a phone has no tabs, so the header says where you are.
  it("names the section under the title, on a phone only", async () => {
    given({ signedIn: true, permissions: ADMIN, split: SPLIT });
    render(await FinancesPage());
    expect(screen.getByRole("banner").textContent).toContain("Overview");
    const css = readFileSync(join(REPO_ROOT, "components/module-frame.module.css"), "utf-8");
    expect(styleOf(css, "where", true).get("display")).toBe("none");
  });

  // Vin, 2026-09-23: the page couldn't scroll to the bottom; the column
  // squashed the cards instead. Children now keep their height.
  it("lets a long page scroll rather than squash its cards", () => {
    const css = readFileSync(join(REPO_ROOT, "components/app-frame.module.css"), "utf-8");
    expect(css).toMatch(/\.main > \* \{\s*flex-shrink: 0;/);
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
});

// September 2026, seen on the 22nd by Alex (the signed-in "user-1"), an
// admin. Split 60/40. Rent $2,000 was due on the 1st and Alex paid
// $1,200 of it on the 2nd; the joint card's $600 is due on the 25th;
// the Amazon card isn't entered yet.
const ME = [
  { user_id: "user-1", name: "Alex", manages_budget: true },
  { user_id: "u-sam", name: "Sam", manages_budget: false },
];
const MY_SPLIT = { ...SPLIT, shares: [{ user_id: "user-1", percent: 60 }, { user_id: "u-sam", percent: 40 }] };
const SEPTEMBER = {
  id: "m-sep",
  starts_on: "2026-09-01",
  closed_at: null,
  closed_by: null,
  closed_automatically: false,
  split_from: null,
  people: [],
  income: [],
  savings: [],
  direct_payments: [],
  bills: [
    {
      id: "mb-rent", name: "Rent", kind: "rent", due_day: 1, amount: "2000.00", personal_answer: null, entered_by: null,
      personal_charges: [], payments: [{ id: "p-1", payer_id: "user-1", amount: "1200.00", created_at: "2026-09-02T15:00:00Z" }],
    },
    {
      id: "mb-joint", name: "Joint card", kind: "card", due_day: 25, amount: "600.00", personal_answer: "none", entered_by: "user-1",
      personal_charges: [], payments: [],
    },
    {
      id: "mb-amazon", name: "Amazon card", kind: "card", due_day: 28, amount: null, personal_answer: null, entered_by: null,
      personal_charges: [], payments: [],
    },
  ],
};

async function showMonth({
  months = [SEPTEMBER],
  bills = [],
  permissions = ADMIN,
  today = "2026-09-22T16:00:00Z",
  month,
}: {
  months?: Record<string, unknown>[];
  bills?: Record<string, unknown>[];
  permissions?: string[];
  today?: string;
  month?: string;
} = {}) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(today));
  fake = fakeSupabase({
    permissions,
    people: ME,
    tables: { splits: [MY_SPLIT], bills, months },
  });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
  render(await FinancesPage({ searchParams: Promise.resolve({ month }) }));
  vi.useRealTimers();
}

const region = (name: string) => screen.getByRole("region", { name });

// REQ-102: the month in the title, no picker, no status pill.
describe("the Finances header", () => {
  it("reads Finances — September 2026, the month in the module colour, with nothing beside it", async () => {
    await showMonth();
    const title = screen.getByRole("heading", { level: 1 });
    expect(title.textContent).toBe("Finances — September 2026");
    expect(title.querySelector("sup")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    const css = readFileSync(join(REPO_ROOT, "components/module-frame.module.css"), "utf-8");
    expect(styleOf(css, "context", false).get("color")).toBe("var(--module-loud)");
  });

  it("has Previous months, the settings gear and Log payment", async () => {
    await showMonth();
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("link", { name: "Previous months" }).getAttribute("href")).toBe("/finances/history");
    expect(within(header).getByRole("link", { name: "Finances settings" }).getAttribute("href")).toBe("/finances/budget-year");
    expect(within(header).getByRole("link", { name: "Log payment" }).getAttribute("href")).toBe("/finances/log-payment");
  });

  it("shows a member no settings gear", async () => {
    await showMonth({ permissions: MEMBER });
    expect(screen.queryByRole("link", { name: "Finances settings" })).toBeNull();
    expect(screen.getByRole("link", { name: "Previous months" })).toBeDefined();
  });

  it("marks a closed month gone by Closed, in plain small text, and keeps it in the tabs", async () => {
    const august = { ...SEPTEMBER, id: "m-aug", starts_on: "2026-08-01", closed_at: "2026-09-01T04:00:00Z" };
    await showMonth({ months: [august, SEPTEMBER], month: "2026-08" });
    const title = screen.getByRole("heading", { level: 1 });
    expect(title.textContent).toBe("Finances — August 2026Closed");
    expect(title.querySelector("sup")?.textContent).toBe("Closed");
    // A closed month takes no payments, on a desktop or a phone.
    const phoneBar = screen.getByRole("main").nextElementSibling as HTMLElement;
    expect(within(screen.getByRole("banner")).queryByRole("link", { name: "Log payment" })).toBeNull();
    expect(within(phoneBar).queryByRole("link", { name: "Log payment" })).toBeNull();
    const tabs = screen.getByRole("navigation", { name: "Finances sections" });
    expect(within(tabs).getByRole("link", { name: "Payments" }).getAttribute("href")).toBe("/finances/payments?month=2026-08");
    expect(within(tabs).getByRole("link", { name: "History" }).getAttribute("href")).toBe("/finances/history");
  });

  it("marks a month gone by that never closed Open, and logs payments against it", async () => {
    const august = { ...SEPTEMBER, id: "m-aug", starts_on: "2026-08-01" };
    await showMonth({ months: [august, SEPTEMBER], month: "2026-08" });
    expect(screen.getByRole("heading", { level: 1 }).querySelector("sup")?.textContent).toBe("Open");
    // The header's button (desktop) and the pinned one (phone) both.
    const phoneBar = screen.getByRole("main").nextElementSibling as HTMLElement;
    for (const place of [screen.getByRole("banner"), phoneBar]) {
      expect(within(place).getByRole("link", { name: "Log payment" }).getAttribute("href")).toBe(
        "/finances/log-payment?month=2026-08",
      );
    }
  });

  it("styles the mark as small plain text, not a pill", () => {
    const css = readFileSync(join(REPO_ROOT, "components/module-frame.module.css"), "utf-8");
    const mark = styleOf(css, "mark", false);
    expect(mark.get("background")).toBeUndefined();
    expect(mark.get("border-radius")).toBeUndefined();
    expect(mark.get("font-size")).toBe("var(--text-caption)");
  });
});

// REQ-103, REQ-104: the tabs.
describe("the Finances tabs", () => {
  it("are Overview, Monthly entry, Payments, Income, Balances, History: no Savings while paused, no Budget year", async () => {
    await showMonth();
    const tabs = screen.getByRole("navigation", { name: "Finances sections" });
    expect(within(tabs).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Overview",
      "Monthly entry",
      "Payments",
      "Income",
      "Balances",
      "History",
    ]);
    expect(within(tabs).getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBe("page");
  });

  it("underline the tab you're on in the module colour", () => {
    const css = readFileSync(join(REPO_ROOT, "components/section-tabs.module.css"), "utf-8");
    expect(styleOf(css, "current", false).get("border-bottom-color")).toBe("var(--module-loud)");
    expect(styleOf(css, "current", false).get("background")).toBeUndefined();
    expect(styleOf(css, "tabs", false).get("display")).toBe("none");
    expect(styleOf(css, "tabs", true).get("display")).toBe("block");
  });
});

// REQ-103: Finances home, top to bottom.
describe("Finances home", () => {
  it("runs Action items, Summary, Who owes what, Bills, in that order", async () => {
    await showMonth();
    const headings = within(screen.getByRole("main"))
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual(["Action items 4", "Still to pay in September", "Who owes what", "Bills"]);
  });

  it("gives each action item its own button on the right", async () => {
    await showMonth();
    const rows = within(region("Action items 4")).getAllByRole("listitem");
    expect(
      rows.map((row) => {
        const action = within(row).getByRole("link");
        return [row.querySelector("span")?.textContent, action.textContent, action.getAttribute("href")];
      }),
    ).toEqual([
      ["Rent overdue$800.00 left to pay", "Log payment", "/finances/log-payment?month=2026-09&bill=mb-rent"],
      ["Joint card due in 3 days$600.00 left to pay", "Log payment", "/finances/log-payment?month=2026-09&bill=mb-joint"],
      ["No payment in 14 daysYou owe $360.00 for September", "Log payment", "/finances/log-payment?month=2026-09"],
      ["Enter September's numbers1 bill still to enter", "Enter numbers", "/finances/monthly-entry?month=2026-09"],
    ]);
  });

  it("shows no action items card when there are none", async () => {
    await showMonth({ months: [] });
    expect(screen.queryByRole("heading", { name: /Action items/ })).toBeNull();
  });

  it("sums up the month: still to pay, the bills, paid so far, the split, one bar", async () => {
    await showMonth();
    const summary = region("Still to pay in September");
    expect(summary.textContent).toBe(
      "Still to pay in September$1,400.00Bills this month$2,600.00Paid so far$1,200.00Split60 / 4046% paid · 1 bill overdue",
    );
  });

  it("gives each person a card: outstanding, share, a bar, paid of owed", async () => {
    await showMonth();
    const people = within(region("Who owes what")).getAllByRole("listitem");
    expect(people.map((person) => person.textContent)).toEqual([
      "Sam40% share$1,040.00outstandingPaid $0.00 of $1,040.00",
      "Alex60% share$360.00outstandingPaid $1,200.00 of $1,560.00",
    ]);
    expect(region("Who owes what").textContent).toContain("How this was worked out");
  });

  it("says Paid in plain text once someone owes nothing", async () => {
    const paid = {
      ...SEPTEMBER,
      bills: [{ ...SEPTEMBER.bills[0], payments: [{ id: "p-1", payer_id: "user-1", amount: "1200.00", created_at: "2026-09-20T15:00:00Z" }] }],
    };
    await showMonth({ months: [paid] });
    expect(within(region("Who owes what")).getAllByRole("listitem")[1].textContent).toBe(
      "Alex60% sharePaidPaid $1,200.00 of $1,200.00",
    );
  });

  it("lists each bill with its due date, progress and what's left; a late one reads Overdue", async () => {
    await showMonth();
    const bills = region("Bills");
    const rows = within(bills).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      "Rent1 Sep · Overdue$1,200.00 of $2,000.00$800.00",
      "Joint card25 Sep$0.00 of $600.00$600.00",
      "Amazon card28 SepNot entered—",
    ]);
    expect(within(bills).getByRole("link", { name: "Edit in Monthly entry" }).getAttribute("href")).toBe(
      "/finances/monthly-entry?month=2026-09",
    );
  });

  // Savings is paused; Close month is only an action item; Budget year is
  // behind the gear.
  it("has no verdict card and no Admin block", async () => {
    await showMonth();
    const main = screen.getByRole("main").textContent;
    expect(main).not.toContain("Nothing to save");
    expect(main).not.toContain("Admin");
    expect(main).not.toContain("Close month");
    expect(main).not.toContain("Budget year");
  });

  it("shows a closed month as it closed: its split, and what was left and whose", async () => {
    const august = {
      ...SEPTEMBER,
      id: "m-aug",
      starts_on: "2026-08-01",
      closed_at: "2026-09-01T14:00:00Z",
      closed_by: "user-1",
      split_from: "2026-04-01",
      people: [
        { user_id: "user-1", percent: "60.00", outstanding: "0.00" },
        { user_id: "u-sam", percent: "40.00", outstanding: "800.00" },
      ],
    };
    await showMonth({ months: [august, SEPTEMBER], month: "2026-08" });
    const closed = region("Closed month");
    expect(closed.textContent).toContain("Closed 1 Sep · split from April 2026: Alex 60% · Sam 40%");
    expect(closed.textContent).toContain("Closed with $800.00 of Sam's unpaid.");
  });

  it("says a month not open yet will open on its own", async () => {
    await showMonth({ months: [], bills: [{ id: "b-rent", name: "Rent", kind: "rent", due_day: 1 }] });
    expect(region("Bills").textContent).toContain("isn't open yet: it opens on its own");
  });

  // REQ-93: "numbers are ready" clears once the other person opens the month.
  function acknowledged() {
    return fake.from.mock.calls.flatMap(([table], index) =>
      table === "action_item_acks"
        ? ((fake.from.mock.results[index].value.upsert as ReturnType<typeof vi.fn>).mock.calls.map(([row]) => row))
        : [],
    );
  }
  const entered = (entered_by: string) => ({
    ...SEPTEMBER,
    bills: [{ ...SEPTEMBER.bills[0], entered_by }],
  });

  it("marks the month's numbers as seen when someone else entered them", async () => {
    await showMonth({ months: [entered("u-sam")] });
    expect(acknowledged()).toEqual([{ key: "ready:2026-09-01" }]);
  });

  it("marks nothing seen for the person who entered the numbers themselves", async () => {
    await showMonth({ months: [entered("user-1")] });
    expect(acknowledged()).toEqual([]);
  });
});

// REQ-103: the module home rules, in the stylesheets.
describe("the module home rules", () => {
  const page = readFileSync(join(REPO_ROOT, "app/finances/page.module.css"), "utf-8");
  const button = readFileSync(join(REPO_ROOT, "components/button.module.css"), "utf-8");

  it("draws every card on the shell background with a 1.5px module-colour border, 20px corners, no shadow", () => {
    const card = styleOf(page, "card", false);
    expect(card.get("background")).toBe("var(--color-ground)");
    expect(card.get("border")).toBe("1.5px solid var(--module-loud)");
    expect(card.get("border-radius")).toBe("var(--radius-lg)");
    expect(card.get("box-shadow")).toBe("none");
  });

  it("uses ink for main text and grey for the rest, never a charcoal fill", () => {
    expect(styleOf(page, "card", false).get("color")).toBe("var(--color-ink)");
    expect(styleOf(page, "note", false).get("color")).toBe("var(--color-muted)");
    expect(page).not.toMatch(/background:\s*var\(--color-(panel|ink)\)/);
  });

  it("has no chips or pills: status is plain text", () => {
    expect(page).not.toMatch(/chip|Chip|\.status/);
  });

  it("has one button: solid module colour, white text, 44px tall, 16px corners, 15px weight 600", () => {
    const style = styleOf(button, "button", false);
    expect(style.get("background")).toBe("var(--module-loud)");
    expect(style.get("color")).toBe("var(--module-on-loud)");
    expect(style.get("min-height")).toBe("44px");
    expect(style.get("border-radius")).toBe("var(--radius-md)");
    expect(style.get("font-size")).toBe("var(--text-body)");
    expect(style.get("font-weight")).toBe("600");
  });
});
