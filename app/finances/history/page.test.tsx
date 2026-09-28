// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../../lib/supabase/server";
import { fakeSupabase } from "../../../test/fake-supabase";
import HistoryPage from "./page";

vi.mock("../../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/finances/history",
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

afterEach(cleanup);

// REQ-102: Previous months leads here; each month opens Finances home on it.
describe("History", () => {
  it("lists every month, newest first, each opening Finances home on it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-22T16:00:00Z"));
    const fake = fakeSupabase({
      permissions: ["use_modules"],
      tables: {
        months: [
          { starts_on: "2026-08-01", closed_at: null },
          { starts_on: "2026-07-01", closed_at: "2026-08-01T04:00:00Z" },
        ],
      },
    });
    vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
    render(await HistoryPage());
    vi.useRealTimers();
    const links = within(screen.getByRole("region", { name: "Months" })).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["September 2026This month", "/finances?month=2026-09"],
      ["August 2026Open", "/finances?month=2026-08"],
      ["July 2026Closed", "/finances?month=2026-07"],
    ]);
    expect(
      within(screen.getByRole("navigation", { name: "Finances sections" }))
        .getByRole("link", { name: "History" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  // REQ-148: the budget year runs April to March; every month of it so
  // far is listed, whether or not it was ever opened.
  it("lists every month of this budget year so far, a gap marked Not entered with Add", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-22T16:00:00Z"));
    const fake = fakeSupabase({
      permissions: ["use_modules"],
      tables: {
        months: [
          { starts_on: "2026-08-01", closed_at: null, added_later: false, settled: false },
          { starts_on: "2026-06-01", closed_at: "2026-09-10T14:00:00Z", added_later: true, settled: true },
          { starts_on: "2026-05-01", closed_at: null, added_later: true, settled: false },
          { starts_on: "2026-04-01", closed_at: "2026-09-12T14:00:00Z", added_later: true, settled: false },
        ],
      },
    });
    vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
    render(await HistoryPage());
    vi.useRealTimers();
    const rows = within(screen.getByRole("region", { name: "Months" })).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "September 2026This month",
      "August 2026Open",
      "July 2026Not enteredAdd",
      "June 2026Settled · Added later",
      "May 2026Open · Added later",
      "April 2026Closed · Added later",
    ]);
    // A month never opened is added, not opened as a link.
    const july = within(rows[2]);
    expect(july.queryByRole("link")).toBeNull();
    const add = july.getByRole("button", { name: "Add July 2026" });
    expect((add.closest("form")!.querySelector('input[name="month"]') as HTMLInputElement).value).toBe("2026-07");
    // Added later still opens Finances home on it, like any month.
    expect(within(rows[3]).getByRole("link").getAttribute("href")).toBe("/finances?month=2026-06");
  });

  it("starts the list at April of the budget year it is, even in January", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-10T16:00:00Z"));
    const fake = fakeSupabase({ permissions: ["use_modules"], tables: { months: [] } });
    vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
    render(await HistoryPage());
    vi.useRealTimers();
    const rows = within(screen.getByRole("region", { name: "Months" })).getAllByRole("listitem");
    expect(rows).toHaveLength(10);
    expect(rows[0].textContent).toBe("January 2027This month");
    expect(rows.at(-1)!.textContent).toBe("April 2026Not enteredAdd");
  });
});

