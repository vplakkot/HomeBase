// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { cookies } from "next/headers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEVICE_COOKIE } from "../lib/notifications/device";
import { createClient } from "../lib/supabase/server";
import { installDialogStandIn } from "../test/dialog";
import tileStyles from "../components/module-tile.module.css";
import HomePage from "./page";

beforeAll(installDialogStandIn);

vi.mock("../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("./sign-out/actions", () => ({ signOut: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
// The notifications control runs in the browser and has its own tests; here
// it only has to be on the page, holding the server's push key.
vi.mock("./notifications/enable-notifications", () => ({
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
    expect(header.textContent).toBe("HomeBaseAdmin");
    const [greeting, ...sections] = within(main).getAllByRole("heading");
    expect(greeting.tagName).toBe("H1");
    expect(sections.map((heading) => heading.textContent)).toEqual([
      "Action items",
      "Modules",
      "Account",
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
  it("keeps every tile quiet, saying Coming soon", async () => {
    given({ email: "member@example.com" });
    render(await home());
    for (const tile of tiles()) {
      expect(tile, tile.name!).toMatchObject({ status: "Coming soon", loud: false });
    }
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

  it("keeps who is signed in on the page", async () => {
    given({ email: "member@example.com" });
    render(await home());
    expect(screen.getByText("Signed in as member@example.com")).toBeDefined();
  });

  it("offers sign-out", async () => {
    given({ email: "member@example.com" });
    render(await home());
    expect(screen.getByRole("button", { name: "Sign out" })).toBeDefined();
  });

  it("sends a signed-out visitor to sign-in", async () => {
    given({ email: null });
    await expect(home()).rejects.toThrow("REDIRECT:/sign-in");
  });

  it("shows an admin the Admin pill, top-right, opening the admin console", async () => {
    given({ email: "admin@example.com", permissions: ["manage_members"] });
    const { container } = render(await home());
    const pill = screen.getByRole("link", { name: "Admin" });
    expect(pill.getAttribute("href")).toBe("/admin");
    // After the brand lockup in the header, which lays the two out left and right.
    expect(container.querySelector("header")?.lastElementChild).toBe(pill);
  });

  it("never shows a member the Admin pill", async () => {
    given({ email: "member@example.com", permissions: ["use_modules"] });
    render(await home());
    expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
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
    expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
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
    expect(screen.getByRole("link", { name: "Admin" }).getAttribute("href")).toBe("/admin");
    expect(screen.queryByText("Admin mode")).toBeNull();
    expect(screen.queryByRole("button", { name: "Back to member view" })).toBeNull();
  });

  it("has no admin-mode switch any more", async () => {
    given({ email: "admin@example.com", permissions: ["manage_members"] });
    render(await home());
    expect(screen.queryByRole("button", { name: "Enter admin mode" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Back to member view" })).toBeNull();
  });

  it("offers notifications, handing over the push key and this device's note", async () => {
    given({ email: "member@example.com", device: "https://web.push.apple.com/this" });
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "public-push-key");
    render(await home());
    expect(screen.getByTestId("notifications").textContent).toBe(
      "public-push-key · https://web.push.apple.com/this",
    );
  });

  it("hands over no device note when this browser never turned notifications on", async () => {
    given({ email: "member@example.com" });
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "public-push-key");
    render(await home());
    expect(screen.getByTestId("notifications").textContent).toBe(
      "public-push-key · no device",
    );
  });

  it("falls back to placeholder build info when Vercel env vars are unset", async () => {
    given({ email: "member@example.com" });
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    render(await home());
    expect(screen.getByTestId("build-info").textContent).toBe("dev · local");
  });

  it("shows the ref and short commit hash when Vercel env vars are set", async () => {
    given({ email: "member@example.com" });
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "main");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abcdef1234567890");
    render(await home());
    expect(screen.getByTestId("build-info").textContent).toBe(
      "main · abcdef1",
    );
  });
});
