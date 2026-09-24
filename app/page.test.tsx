// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { cookies } from "next/headers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FinanceSnapshot } from "../lib/finances/action-items";
import { readFinanceSnapshot } from "../lib/finances/snapshot";
import { DEVICE_COOKIE } from "../lib/notifications/device";
import { createClient } from "../lib/supabase/server";
import { installDialogStandIn } from "../test/dialog";
import tileStyles from "../components/module-tile.module.css";
import HomePage from "./page";

beforeAll(installDialogStandIn);

vi.mock("../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("./sign-out/actions", () => ({ signOut: vi.fn() }));
vi.mock("../lib/finances/snapshot", () => ({ readFinanceSnapshot: vi.fn() }));

// Finances before setup: no split, no bills, nothing to do.
const NOT_SET_UP: FinanceSnapshot = {
  today: "2026-09-24",
  people: [{ user_id: "user-1", name: "Sam", manages_budget: true }],
  splits: [],
  billCount: 0,
  months: [],
  balances: [],
  acks: [],
};

function finances(snapshot: Partial<FinanceSnapshot> = {}) {
  vi.mocked(readFinanceSnapshot).mockResolvedValue({ ...NOT_SET_UP, ...snapshot });
}
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
// The notifications control runs in the browser and has its own tests; here
// it only has to be on the page, holding the server's push key.
vi.mock("./notifications/enable-notifications", () => ({
  KeepThisDevice: ({ publicKey, knownDevice }: { publicKey?: string; knownDevice?: string | null }) => (
    <i data-testid="upkeep">{`${publicKey ?? "no key"} · ${knownDevice ?? "no device"}`}</i>
  ),
  EnableNotifications: ({
    publicKey,
    knownDevice,
  }: {
    publicKey?: string;
    knownDevice?: string | null;
  }) => (
    <p data-testid="notifications">{`${publicKey ?? "no key"} · ${knownDevice ?? "no device"}`}</p>
  ),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

function given({
  email,
  name,
  permissions = [],
  device,
  otherCookies = {},
}: {
  email: string | null;
  name?: string;
  permissions?: string[];
  device?: string;
  otherCookies?: Record<string, string>;
}) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getClaims: vi.fn().mockResolvedValue({
        data:
          email === null
            ? null
            : { claims: { email, sub: "user-1", user_metadata: name ? { name } : {} } },
        error: null,
      }),
    },
    rpc: vi.fn(async (_fn: string, args: { permission: string }) => ({
      data: permissions.includes(args.permission),
      error: null,
    })),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  finances();
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => {
      if (name === DEVICE_COOKIE && device) return { value: device };
      return name in otherCookies ? { value: otherCookies[name] } : undefined;
    },
  } as unknown as Awaited<ReturnType<typeof cookies>>);
}

// Home as the browser asks for it, with whatever follows ? in the address.
function home(params: Record<string, string> = {}) {
  return HomePage({ searchParams: Promise.resolve(params) });
}

function tiles() {
  const modules = screen.getByRole("region", { name: "Modules" });
  return within(modules)
    .getAllByRole("listitem")
    .map((item) => {
      const tile = item.firstElementChild as HTMLElement;
      return {
        name: tile.querySelector(`.${tileStyles.name}`)?.textContent,
        status: tile.querySelector(`.${tileStyles.status}`)?.textContent,
        loud: tile.classList.contains(tileStyles.loud),
      };
    });
}

// The account pill at the top right of phone Home, and what it opens.
function pill(): HTMLElement {
  return screen.getByRole("main").querySelector("header button[aria-haspopup]") as HTMLElement;
}

function openMenu(item?: "Profile" | "Settings"): HTMLElement {
  fireEvent.click(pill());
  const menu = screen.getByRole("dialog", { name: "Account" });
  if (!item) return menu;
  fireEvent.click(within(menu).getByRole("button", { name: item }));
  return screen.getByRole("dialog", { name: item });
}

describe("HomePage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  // REQ-81, phone: brand and Admin pill, greeting and date, action items,
  // then the modules, all in the one scrolling area.
  it("runs top to bottom as the design does", async () => {
    given({ email: "admin@example.com", permissions: ["manage_members"] });
    render(await home());
    const main = screen.getByRole("main");
    const header = main.firstElementChild!;
    expect(header.tagName).toBe("HEADER");
    expect(header.firstElementChild?.textContent).toBe("HomeBase");
    expect(pill().textContent).toBe("AAccount");
    const [greeting, ...sections] = within(main).getAllByRole("heading");
    expect(greeting.tagName).toBe("H1");
    expect(sections.map((heading) => heading.textContent)).toEqual([
      "Action items",
      "Modules",
    ]);
  });

  it("greets the person by first name, when the account has one", async () => {
    given({ email: "sam@example.com", name: "Sam Example" });
    render(await home());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/, Sam$/);
  });

  it("shows All clear where action items go, until there are any", async () => {
    given({ email: "member@example.com" });
    render(await home());
    const section = screen.getByRole("region", { name: "Action items" });
    expect(section.textContent).toContain("All clear");
    expect(section.textContent).toContain("No action items today");
  });

  // A decision of 2026-09-21: all six show, only Finances opens.
  it("shows a tile for all six modules, only Finances a link", async () => {
    given({ email: "member@example.com" });
    render(await home());
    expect(tiles().map((tile) => tile.name)).toEqual([
      "Finances",
      "Calendar",
      "Pets",
      "Wine",
      "Meal Plans",
      "Health",
    ]);
    const modules = screen.getByRole("region", { name: "Modules" });
    expect(within(modules).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/finances",
    ]);
  });

  // REQ-82, and a decision of 2026-09-21: until modules have data, Home
  // shows no invented state unless ?demo asks for it.
  it("keeps every tile quiet: Finances says it isn't set up, the rest Coming soon", async () => {
    given({ email: "member@example.com" });
    render(await home());
    const [money, ...others] = tiles();
    expect(money).toMatchObject({ status: "Not set up", loud: false });
    for (const tile of others) {
      expect(tile, tile.name!).toMatchObject({ status: "Coming soon", loud: false });
    }
  });

  // REQ-91: a module's real item reaches Home, opens the exact screen,
  // and makes its tile loud.
  it("shows Finances' own item as a link to where it's done, with the tile loud", async () => {
    given({ email: "member@example.com" });
    finances({
      splits: [{ id: "s", effective_from: "2026-09-01", note: "", shares: [{ user_id: "user-1", percent: 100 }] }],
      billCount: 2,
    });
    render(await home());
    const section = screen.getByRole("region", { name: "Action items" });
    const link = within(section).getByRole("link");
    expect(link.textContent).toContain("Enter September's numbers");
    expect(link.getAttribute("href")).toBe("/finances/monthly-entry?month=2026-09");
    expect(tiles()[0]).toMatchObject({ status: "Enter September's numbers", loud: true });
  });

  it("with ?demo, shows the design's example, loud and quiet tiles side by side", async () => {
    given({ email: "member@example.com" });
    render(await home({ demo: "" }));
    expect(tiles()).toEqual([
      { name: "Finances", status: "$285 due", loud: true },
      { name: "Calendar", status: "Dentist Thu", loud: false },
      { name: "Pets", status: "Pill due today", loud: true },
      { name: "Wine", status: "9 bottles", loud: false },
      { name: "Meal Plans", status: "Tacos tonight", loud: false },
      { name: "Health", status: "Refill ready", loud: true },
    ]);
  });

  // REQ-83: the card shows the most urgent items from the same stand-in
  // the tiles read, so a loud tile always has its item nearby.
  it("with ?demo, puts the three most urgent items in the card", async () => {
    given({ email: "member@example.com" });
    render(await home({ demo: "" }));
    const section = screen.getByRole("region", { name: "Action items" });
    expect(within(section).getByText("1 / 3")).toBeDefined();
    expect(within(section).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Card bill due Friday$285 left to pay",
      "Heartworm pill dueBoth dogs, today",
      "Prescription readyPick up by Tuesday",
    ]);
  });

  it("with ?demo=0, shows All clear and every tile quiet", async () => {
    given({ email: "member@example.com" });
    render(await home({ demo: "0" }));
    const section = screen.getByRole("region", { name: "Action items" });
    expect(section.textContent).toContain("All clear");
    expect(tiles().filter((tile) => tile.loud)).toEqual([]);
  });

  it("with ?demo=4, lights four tiles but keeps the card to the three most urgent", async () => {
    given({ email: "member@example.com" });
    render(await home({ demo: "4" }));
    expect(tiles().filter((tile) => tile.loud).map((tile) => tile.name)).toEqual([
      "Finances",
      "Calendar",
      "Pets",
      "Health",
    ]);
    const section = screen.getByRole("region", { name: "Action items" });
    expect(within(section).getAllByRole("listitem")).toHaveLength(3);
    expect(section.textContent).not.toContain("Confirm the dentist");
  });

  // Phones get a bar fixed below the page; desktops get buttons beside the
  // greeting. The screen width shows one and hides the other.
  it("offers Quick add twice: a bar for phones, buttons for desktops", async () => {
    given({ email: "member@example.com" });
    render(await home());
    const main = screen.getByRole("main");
    const phoneBar = main.nextElementSibling as HTMLElement;
    for (const place of [phoneBar, main]) {
      const group = within(place).getByRole("group", { name: "Quick add" });
      expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual([
        "Expense",
        "Event",
        "Meal",
      ]);
    }
  });

  // The tiles are the navigation on a phone's Home, so its bar holds
  // Quick add and nothing that goes anywhere.
  it("has no navigation bar on a phone's Home", async () => {
    given({ email: "member@example.com" });
    render(await home());
    const phoneBar = screen.getByRole("main").nextElementSibling as HTMLElement;
    expect(within(phoneBar).queryAllByRole("link")).toEqual([]);
    expect(within(phoneBar).queryAllByRole("navigation")).toEqual([]);
  });

  // REQ-85: who you are, sign-out and notifications moved into the pill.
  it("shows who is signed in under the pill's Profile", async () => {
    given({ email: "member@example.com" });
    render(await home());
    expect(openMenu("Profile").textContent).toContain("Signed in as member@example.com");
  });

  it("keeps nothing about the account at the bottom of Home any more", async () => {
    given({ email: "member@example.com" });
    render(await home());
    const main = screen.getByRole("main");
    expect(within(main).queryByRole("region", { name: "Account" })).toBeNull();
    expect(within(main).queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(within(main).queryByTestId("notifications")).toBeNull();
  });

  it("names the pill after the person, when the account has a name", async () => {
    given({ email: "sam@example.com", name: "Sam Example" });
    render(await home());
    expect(pill().textContent).toBe("SSam");
  });

  it("offers Profile, Settings and Sign out in the pill's menu", async () => {
    given({ email: "member@example.com" });
    render(await home());
    const menu = openMenu();
    expect(within(menu).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Close",
      "Profile",
      "Settings",
      "Sign out",
    ]);
  });

  it("sends a signed-out visitor to sign-in", async () => {
    given({ email: null });
    await expect(home()).rejects.toThrow("REDIRECT:/sign-in");
  });

  it("gives an admin the admin console in the pill's menu", async () => {
    given({ email: "admin@example.com", permissions: ["manage_members"] });
    render(await home());
    const link = within(openMenu()).getByRole("link", { name: "Admin console" });
    expect(link.getAttribute("href")).toBe("/admin");
  });

  it("never offers a member the admin console", async () => {
    given({ email: "member@example.com", permissions: ["use_modules"] });
    render(await home());
    expect(within(openMenu()).queryByRole("link", { name: "Admin console" })).toBeNull();
  });

  // v0.1 kept an "admin mode" in a cookie. It's gone, and so is anything
  // that read it: only the permission decides.
  it("ignores a leftover admin-mode cookie from v0.1", async () => {
    given({
      email: "member@example.com",
      permissions: ["use_modules"],
      otherCookies: { "homebase-mode": "admin" },
    });
    render(await home());
    expect(within(openMenu()).queryByRole("link", { name: "Admin console" })).toBeNull();
  });

  // The one case where v0.1 behaved differently: an admin whose browser
  // still holds the old cookie. v0.1 showed them a banner and a way back
  // to member view; now they get the same Home as any other admin.
  it("gives an admin with a leftover admin-mode cookie the plain Home", async () => {
    given({
      email: "admin@example.com",
      permissions: ["manage_members"],
      otherCookies: { "homebase-mode": "admin" },
    });
    render(await home());
    expect(within(openMenu()).getByRole("link", { name: "Admin console" })).toBeDefined();
    expect(screen.queryByText("Admin mode")).toBeNull();
    expect(screen.queryByRole("button", { name: "Back to member view" })).toBeNull();
  });

  it("has no admin-mode switch any more", async () => {
    given({ email: "admin@example.com", permissions: ["manage_members"] });
    render(await home());
    expect(screen.queryByRole("button", { name: "Enter admin mode" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Back to member view" })).toBeNull();
  });

  it("offers this device's notifications under Settings, with the push key and note", async () => {
    given({ email: "member@example.com", device: "https://web.push.apple.com/this" });
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "public-push-key");
    render(await home());
    expect(within(openMenu("Settings")).getByTestId("notifications").textContent).toBe(
      "public-push-key · https://web.push.apple.com/this",
    );
  });

  // The control moved into Settings, but Home still checks the device on
  // every load, as it did when the control lived on Home.
  it("still checks this device on every load, out of sight", async () => {
    given({ email: "member@example.com", device: "https://web.push.apple.com/this" });
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "public-push-key");
    render(await home());
    expect(screen.getByTestId("upkeep").textContent).toBe(
      "public-push-key · https://web.push.apple.com/this",
    );
  });

  it("hands over no device note when this browser never turned notifications on", async () => {
    given({ email: "member@example.com" });
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "public-push-key");
    render(await home());
    expect(within(openMenu("Settings")).getByTestId("notifications").textContent).toBe(
      "public-push-key · no device",
    );
  });

  it("shows the build under Settings, a placeholder off Vercel", async () => {
    given({ email: "member@example.com" });
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    render(await home());
    expect(within(openMenu("Settings")).getByTestId("build-info").textContent).toBe(
      "dev · local",
    );
  });

  it("shows the ref and short commit hash when Vercel env vars are set", async () => {
    given({ email: "member@example.com" });
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "main");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abcdef1234567890");
    render(await home());
    expect(within(openMenu("Settings")).getByTestId("build-info").textContent).toBe(
      "main · abcdef1",
    );
  });
});
