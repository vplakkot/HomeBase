// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import { REPO_ROOT, styleOf } from "../../test/css";
import { installDialogStandIn } from "../../test/dialog";
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

function given({ signedIn, permissions = [] }: { signedIn: boolean; permissions?: string[] }) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getClaims: vi.fn().mockResolvedValue({
        data: signedIn ? { claims: { sub: "user-1" } } : null,
        error: null,
      }),
    },
    rpc: vi.fn(async (_fn: string, args: { permission: string }) => ({
      data: permissions.includes(args.permission),
      error: null,
    })),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

describe("the Finances page", () => {
  it("sends a signed-out visitor to sign-in", async () => {
    given({ signedIn: false });
    await expect(FinancesPage()).rejects.toThrow("REDIRECT:/sign-in");
  });

  it.each([
    ["a member", ["use_modules"]],
    ["an admin", ["use_modules", "manage_members"]],
  ])("is open to %s, as an empty shell saying it's coming", async (_who, permissions) => {
    given({ signedIn: true, permissions });
    render(await FinancesPage());
    const main = screen.getByRole("main");
    expect(within(main).getByRole("heading", { level: 1 }).textContent).toBe("Finances");
    expect(main.textContent).toContain("Coming soon");
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
