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
});
