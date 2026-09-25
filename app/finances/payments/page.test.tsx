// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../../lib/supabase/server";
import { fakeSupabase } from "../../../test/fake-supabase";
import PaymentsPage from "./page";

vi.mock("../../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/finances/payments",
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

afterEach(cleanup);

const PEOPLE = [
  { user_id: "u-alex", name: "Alex", manages_budget: true },
  { user_id: "u-sam", name: "Sam", manages_budget: false },
];
const bill = (id: string, name: string, payments: unknown[]) => ({
  id, name, kind: "card", due_day: 20, amount: "1000.00", personal_answer: "none", personal_charges: [], payments,
});
const MONTH = (startsOn: string, extra: Record<string, unknown> = {}) => ({
  id: `m-${startsOn}`,
  starts_on: startsOn,
  closed_at: null,
  people: [],
  income: [],
  savings: [],
  direct_payments: [],
  bills: [],
  ...extra,
});

async function show(months: unknown[], month?: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-22T16:00:00Z"));
  const fake = fakeSupabase({ permissions: ["use_modules"], people: PEOPLE, tables: { months } });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
  render(await PaymentsPage({ searchParams: Promise.resolve({ month }) }));
  vi.useRealTimers();
}

// REQ-104: every payment logged in the month, newest first.
describe("the Payments tab", () => {
  it("lists every payment in the month: date, who, toward a bill or Direct payment, amount — newest first", async () => {
    await show([
      MONTH("2026-09-01", {
        bills: [
          bill("mb-visa", "Chase Visa", [
            { id: "p-1", payer_id: "u-alex", amount: "600.00", created_at: "2026-09-03T15:00:00Z" },
            // Logged at 11pm in New York on the 18th: the 19th in UTC.
            { id: "p-2", payer_id: "u-sam", amount: "400.00", created_at: "2026-09-19T03:00:00Z" },
          ]),
        ],
        direct_payments: [{ id: "d-1", payer_id: "u-sam", amount: "45.50", note: "Taxi", paid_on: "2026-09-10" }],
      }),
    ]);
    const card = screen.getByRole("region", { name: "Payments made" });
    const rows = within(card).getAllByRole("row");
    expect(rows.map((row) => row.textContent)).toEqual([
      "DatePaid byTowardAmount",
      "18 SepSamChase Visa$400.00",
      "10 SepSamDirect payment$45.50",
      "3 SepAlexChase Visa$600.00",
    ]);
    expect(card.textContent).toContain("3 payments · $1,045.50 in September");
  });

  it("says so when nothing is logged yet", async () => {
    await show([MONTH("2026-09-01")]);
    const card = screen.getByRole("region", { name: "Payments made" });
    expect(card.textContent).toContain("0 payments · $0.00 in September");
    expect(card.textContent).toContain("No payments logged yet");
  });

  it("shows a past month's payments when History opened it", async () => {
    await show(
      [
        MONTH("2026-08-01", {
          closed_at: "2026-09-01T04:00:00Z",
          bills: [bill("mb-rent", "Rent", [{ id: "p-9", payer_id: "u-alex", amount: "1000.00", created_at: "2026-08-02T15:00:00Z" }])],
        }),
        MONTH("2026-09-01"),
      ],
      "2026-08",
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Finances — August 2026Closed");
    expect(screen.getByRole("region", { name: "Payments made" }).textContent).toContain("1 payment · $1,000.00 in August");
  });

  it("is the tab after Monthly entry, and marks itself as where you are", async () => {
    await show([MONTH("2026-09-01")]);
    const tabs = screen.getByRole("navigation", { name: "Finances sections" });
    const names = within(tabs).getAllByRole("listitem").map((item) => item.textContent);
    expect(names.indexOf("Payments")).toBe(names.indexOf("Monthly entry") + 1);
    expect(within(tabs).getByRole("link", { name: "Payments" }).getAttribute("aria-current")).toBe("page");
  });
});
