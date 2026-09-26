// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { cookies } from "next/headers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "../lib/supabase/server";
import { fakeSupabase } from "../test/fake-supabase";
import { installDialogStandIn } from "../test/dialog";
import FinancesPage from "./finances/page";
import HomePage from "./page";

// REQ-18: every action on a desktop is also on a phone. The phone may
// put it behind an extra tap, never take it away.
//
// Both layouts are in every page, and the screen width shows one: the
// sidebar is the desktop's navigation, and everything else (the page, the
// bar at the bottom and its sheets) is what a phone shows. So the places
// the sidebar can take you, across the app, must all be reachable
// somewhere outside it.

vi.mock("../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/finances",
}));
vi.mock("./sign-out/actions", () => ({ signOut: vi.fn() }));
vi.mock("./notifications/enable-notifications", () => ({
  EnableNotifications: () => null,
  KeepThisDevice: () => null,
}));

beforeAll(installDialogStandIn);
afterEach(cleanup);

function signedInWith(permissions: string[]) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getClaims: vi.fn().mockResolvedValue({
        data: { claims: { email: "someone@example.com", sub: "user-1" } },
        error: null,
      }),
    },
    rpc: fakeSupabase({ permissions }).rpc,
    from: fakeSupabase().from,
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  vi.mocked(cookies).mockResolvedValue({
    get: () => undefined,
  } as unknown as Awaited<ReturnType<typeof cookies>>);
}

async function placesOn(page: () => Promise<React.ReactElement>) {
  render(await page());
  const sidebar = screen.getByRole("navigation", { name: "Main" });
  const hrefs = (links: Element[]) => links.map((link) => link.getAttribute("href")!);
  const all = [...document.querySelectorAll("a[href]")];
  const desktop = hrefs(all.filter((link) => sidebar.contains(link)));
  const phone = hrefs(all.filter((link) => !sidebar.contains(link)));
  cleanup();
  return { desktop, phone };
}

// Home as the browser asks for it, with nothing after ? in the address.
const Home = () => HomePage({ searchParams: Promise.resolve({}) });

describe.each([
  ["an admin", ["use_modules", "manage_members"], ["/", "/admin", "/drinks", "/finances", "/paperwork", "/storage"]],
  ["a member", ["use_modules"], ["/", "/drinks", "/finances", "/paperwork", "/storage"]],
])("for %s", (_who, permissions, expected) => {
  it("a phone reaches everywhere the desktop sidebar does", async () => {
    signedInWith(permissions);
    const desktop = new Set<string>();
    const phone = new Set<string>();
    for (const page of [Home, FinancesPage]) {
      const places = await placesOn(page);
      places.desktop.forEach((href) => desktop.add(href));
      places.phone.forEach((href) => phone.add(href));
    }
    expect([...desktop].sort()).toEqual(expected);
    for (const href of desktop) {
      expect(phone.has(href), `${href} is reachable on a phone`).toBe(true);
    }
  });
});
