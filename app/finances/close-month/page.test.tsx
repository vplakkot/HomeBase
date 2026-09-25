// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../../lib/supabase/server";
import { fakeSupabase } from "../../../test/fake-supabase";
import CloseMonthPage from "./page";

vi.mock("../../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/finances/close-month",
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const PEOPLE = [
  { user_id: "u-alex", name: "Alex", manages_budget: true },
  { user_id: "u-sam", name: "Sam", manages_budget: false },
];
const SPLIT = { id: "s-1", effective_from: "2026-04-01", note: "", shares: [{ user_id: "u-alex", percent: 60 }, { user_id: "u-sam", percent: 40 }] };
const AUGUST = {
  id: "m-aug",
  starts_on: "2026-08-01",
  closed_at: null as string | null,
  people: [],
  income: [],
  savings: [],
  direct_payments: [],
  bills: [
    {
      id: "mb-rent", name: "Rent", kind: "rent", due_day: 1, amount: "2000.00", personal_answer: null, personal_charges: [],
      payments: [{ id: "p-1", payer_id: "u-alex", amount: "1200.00", created_at: "2026-08-02T15:00:00Z" }],
    },
  ],
};

async function show(permissions: string[], month = AUGUST, today = "2026-09-02T16:00:00Z") {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(today));
  const fake = fakeSupabase({ permissions, people: PEOPLE, tables: { splits: [SPLIT], months: [month] } });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
  return CloseMonthPage({ searchParams: Promise.resolve({ month: "2026-08" }) });
}

// REQ-59 behind the "ended, not squared" action item (REQ-103).
describe("Close month", () => {
  it("shows an admin who still owes what, then closes the month on purpose", async () => {
    render(await show(["use_modules", "manage_budget"]));
    const card = screen.getByRole("region", { name: "Close August 2026 with a balance" });
    expect(card.textContent).toContain("Sam still owes $800.00. Closing records that and locks August 2026");
    const close = screen.getByRole("button", { name: "Close August 2026" });
    expect(new FormData(close.closest("form")!).get("monthId")).toBe("m-aug");
  });

  it("sends a member back to Finances home", async () => {
    await expect(show(["use_modules"])).rejects.toThrow("REDIRECT:/finances");
  });

  it("sends the admin back for a month still running or already closed", async () => {
    await expect(show(["use_modules", "manage_budget"], AUGUST, "2026-08-20T16:00:00Z")).rejects.toThrow("REDIRECT:/finances");
    await expect(
      show(["use_modules", "manage_budget"], { ...AUGUST, closed_at: "2026-09-01T04:00:00Z" }),
    ).rejects.toThrow("REDIRECT:/finances");
  });
});
