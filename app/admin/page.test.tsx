// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import { REPO_ROOT, styleOf } from "../../test/css";
import { installDialogStandIn } from "../../test/dialog";
import { switchTable } from "../../test/module-switches";
import AdminPage from "./page";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
// REQ-125, REQ-160: the devices come through the secret key; here, a fixed answer.
const device = (id: string, name: string, thisDevice = false) => ({
  id,
  name,
  addedAt: "2026-10-01T12:00:00Z",
  lastReceivedAt: id === "d1" ? "2026-10-02T09:30:00Z" : null,
  thisDevice,
});
const deviceLists = new Map([["u2", [device("d1", "iPhone, Safari"), device("d2", "Mac, Chrome")]]]);
vi.mock("../../lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("../../lib/notifications/devices", async (original) => ({
  ...(await original<typeof import("../../lib/notifications/devices")>()),
  listDevices: vi.fn(async () => deviceLists),
}));
vi.mock("./send-test-form", () => ({
  SendTestForm: () => <button type="button">Send test now</button>,
}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

const roles = [
  { id: "role-a", name: "Chief" },
  { id: "role-b", name: "Helper" },
];
const members = [
  {
    user_id: "u1",
    name: null,
    email: "first@example.com",
    role_id: "role-a",
    role_name: "Chief",
    notifications_enabled: false,
  },
  {
    user_id: "u2",
    name: "Sam",
    email: "sam@example.com",
    role_id: "role-b",
    role_name: "Helper",
    notifications_enabled: true,
  },
];

function given({
  signedIn,
  permissions = [],
  log = [] as Record<string, unknown>[],
  logFails = false,
  off = [],
}: {
  signedIn: boolean;
  off?: string[];
  permissions?: string[];
  log?: Record<string, unknown>[];
  logFails?: boolean;
}) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getClaims: vi.fn().mockResolvedValue({
        data: signedIn ? { claims: { sub: "u1" } } : null,
        error: null,
      }),
    },
    rpc: vi.fn(async (fn: string, args?: { permission: string }) => {
      if (fn === "has_permission") {
        return { data: permissions.includes(args?.permission ?? ""), error: null };
      }
      if (fn === "household_members_overview") {
        return { data: members, error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    }),
    from: vi.fn((table: string) => {
      const switches = switchTable(table, { off });
      if (switches) return switches;
      if (table === "notification_log") {
        return {
          select: vi.fn(() => ({
            gte: vi.fn(() => ({
              order: vi.fn().mockResolvedValue(
                logFails
                  ? { data: null, error: { message: "denied" } }
                  : { data: log, error: null },
              ),
            })),
          })),
        };
      }
      return {
        select: vi.fn(() => ({
          order: vi.fn().mockResolvedValue({ data: roles, error: null }),
        })),
      };
    }),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

beforeAll(installDialogStandIn);

describe("AdminPage", () => {
  afterEach(cleanup);

  it("sends a signed-out visitor to sign-in", async () => {
    given({ signedIn: false });
    await expect(AdminPage()).rejects.toThrow("REDIRECT:/sign-in");
  });

  it("refuses a member who types the URL", async () => {
    given({ signedIn: true, permissions: ["use_modules"] });
    await expect(AdminPage()).rejects.toThrow("REDIRECT:/");
  });

  it("says how many devices each person has registered (REQ-125)", async () => {
    given({ signedIn: true, permissions: ["manage_members"] });
    render(await AdminPage());
    const card = screen.getByRole("region", { name: "Notifications" });
    expect(within(card).getByText("No device")).toBeTruthy();
    expect(within(card).getByText("2 devices")).toBeTruthy();
  });

  it("pages the notification log from the address (REQ-126)", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      id: `r${i}`,
      sent_at: new Date(Date.UTC(2026, 9, 4, 12, 0) - i * 60_000).toISOString(),
      trigger: "manual",
      user_id: "u2",
      device: "abc123def456",
      delivered_at: null,
      tapped_at: null,
      accepted: true,
      failure_code: null,
    }));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-04T13:00:00Z"));
    given({ signedIn: true, permissions: ["manage_members"], log: rows });
    render(await AdminPage({ searchParams: Promise.resolve({ page: "2" }) }));
    vi.useRealTimers();
    expect(screen.getByText("Page 2 of 2")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Previous" }).getAttribute("href")).toBe("/admin?page=1");
  });

  it("has a card for the build this installed app is running (REQ-123)", async () => {
    given({ signedIn: true, permissions: ["manage_members"] });
    render(await AdminPage());
    const card = screen.getByRole("region", { name: "This app" });
    expect(within(card).getByTestId("admin-build")).toBeTruthy();
  });

  // DESIGN.md §8: on a phone the console is reached from Home's Admin pill
  // and has a way back at the top; a desktop has the sidebar instead.
  it("starts with the way back Home, for phones", async () => {
    given({ signedIn: true, permissions: ["manage_members"] });
    render(await AdminPage());
    const back = screen.getByRole("main").firstElementChild!;
    expect(back.textContent).toBe("Home");
    expect(back.getAttribute("href")).toBe("/");
  });

  it("marks the admin console as where you are, in the desktop sidebar", async () => {
    given({ signedIn: true, permissions: ["manage_members"] });
    render(await AdminPage());
    const sidebar = screen.getByRole("navigation", { name: "Main" });
    const here = within(sidebar)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(here.map((link) => link.textContent)).toEqual(["Admin console"]);
  });

  it("lists every member in the People card, with name, email and role", async () => {
    given({ signedIn: true, permissions: ["manage_members"] });
    render(await AdminPage());
    const people = screen.getByRole("region", { name: "People" });
    const rows = within(people).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("first@example.com");
    expect(within(rows[1]).getByText("Sam")).toBeDefined();
    expect(within(rows[1]).getByText("sam@example.com")).toBeDefined();
    const samRole = screen.getByRole("combobox", { name: "Role for Sam" }) as HTMLSelectElement;
    expect(samRole.value).toBe("role-b");
    expect(within(samRole).getAllByRole("option").map((o) => o.textContent)).toEqual(["Chief", "Helper"]);
  });

  it("offers a name, a role change and a password reset for each member", async () => {
    given({ signedIn: true, permissions: ["manage_members"] });
    render(await AdminPage());
    // REQ-124: each member's name, starting from the saved one; blank
    // when they have none.
    expect((screen.getByRole("textbox", { name: "Name for Sam" }) as HTMLInputElement).value).toBe("Sam");
    expect((screen.getByRole("textbox", { name: "Name for first@example.com" }) as HTMLInputElement).value).toBe("");
    expect(screen.getAllByRole("button", { name: "Save name" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Save role" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Reset password" })).toHaveLength(2);
    expect(screen.getByRole("textbox", { name: "Temporary password for Sam" })).toBeDefined();
  });

  it("shows each member's notification switch, reflecting what it is now", async () => {
    given({ signedIn: true, permissions: ["manage_members"] });
    render(await AdminPage());
    const first = screen.getByRole("switch", { name: "Notifications for first@example.com" });
    const sam = screen.getByRole("switch", { name: "Notifications for Sam" });
    expect(first.getAttribute("aria-checked")).toBe("false");
    expect(sam.getAttribute("aria-checked")).toBe("true");
  });

  it("asks for the opposite state, so submitting twice can't flip someone back", async () => {
    given({ signedIn: true, permissions: ["manage_members"] });
    render(await AdminPage());
    const off = screen.getByRole("switch", { name: "Notifications for first@example.com" });
    const on = screen.getByRole("switch", { name: "Notifications for Sam" });
    const asked = (button: HTMLElement) =>
      button.closest("form")?.querySelector<HTMLInputElement>('input[name="enabled"]')?.value;
    expect(asked(off)).toBe("true");
    expect(asked(on)).toBe("false");
  });

  it("still offers the create-member form, behind Add person", async () => {
    given({ signedIn: true, permissions: ["manage_members"] });
    render(await AdminPage());
    const people = screen.getByRole("region", { name: "People" });
    fireEvent.click(within(people).getByRole("button", { name: "Add person" }));
    expect(screen.getByLabelText("Name")).toBeDefined();
    expect(screen.getByLabelText("Email")).toBeDefined();
    expect(screen.getByRole("button", { name: "Create member" })).toBeDefined();
  });

  it("offers a test notification, explaining who gets it", async () => {
    given({ signedIn: true, permissions: ["manage_members"] });
    render(await AdminPage());
    const section = screen.getByRole("region", { name: "Notifications" });
    expect(within(section).getByRole("button", { name: "Send test now" })).toBeDefined();
    expect(within(section).getByText(/The switch decides whether a person gets notifications at all/)).toBeDefined();
    expect(within(section).getByText(/tests everyone switched on/)).toBeDefined();
  });

  // REQ-84: DESIGN.md §8's three cards, in the design's order per screen.
  it("shows People, Notifications and Modules cards, in each screen's order", async () => {
    given({ signedIn: true, permissions: ["manage_members"] });
    render(await AdminPage());
    for (const name of ["People", "Notifications", "Modules"]) {
      expect(screen.getByRole("region", { name })).toBeDefined();
    }
    const css = readFileSync(join(REPO_ROOT, "app/admin/page.module.css"), "utf-8");
    const areas = (desktop: boolean) =>
      styleOf(css, "cards", desktop).get("grid-template-areas")?.replace(/\s+/g, " ");
    expect(areas(false)).toBe('"notifications" "modules" "people"');
    expect(areas(true)).toBe('"people modules" "notifications modules"');
  });

  // REQ-141.
  it("has a working switch per module, with Paperwork & Storage sharing one", async () => {
    given({ signedIn: true, permissions: ["manage_members"] });
    render(await AdminPage());
    const modules = screen.getByRole("region", { name: "Modules" });
    const switches = within(modules).getAllByRole("switch");
    expect(switches.map((s) => s.getAttribute("aria-label"))).toEqual(
      ["Finances", "Calendar", "Pets", "Drinks", "Meal Plans", "Health", "Paperwork & Storage", "Restaurants"].map(
        (name) => `${name} module`,
      ),
    );
    for (const s of switches) {
      expect((s as HTMLButtonElement).disabled).toBe(false);
      expect(s.getAttribute("aria-checked")).toBe("true");
    }
    expect(within(modules).queryByRole("switch", { name: "Storage module" })).toBeNull();
    expect(modules.textContent).toContain("share one switch");
  });

  it("shows a module that's off as off for everyone", async () => {
    given({ signedIn: true, permissions: ["manage_members"], off: ["pets"] });
    render(await AdminPage());
    const modules = screen.getByRole("region", { name: "Modules" });
    const pets = within(modules).getByRole("switch", { name: "Pets module" });
    expect(pets.getAttribute("aria-checked")).toBe("false");
    expect(pets.closest("li")?.textContent).toContain("Off for everyone");
  });

  it("asks before turning a module off, and deletes nothing", async () => {
    given({ signedIn: true, permissions: ["manage_members"] });
    render(await AdminPage());
    const modules = screen.getByRole("region", { name: "Modules" });
    fireEvent.click(within(modules).getByRole("switch", { name: "Drinks module" }));
    const sheet = screen.getByRole("dialog", { name: "Turn off Drinks" });
    expect(sheet.textContent).toContain("Nothing is deleted");
    expect(within(sheet).getByRole("button", { name: "Yes, turn it off" })).toBeTruthy();
    expect((sheet.querySelector('input[name="on"]') as HTMLInputElement).value).toBe("false");
  });

  // REQ-159: a test for one person, only while their switch is on.
  it("shows a Send test per person, working only for someone switched on", async () => {
    given({ signedIn: true, permissions: ["manage_members"] });
    render(await AdminPage());
    const notifications = screen.getByRole("region", { name: "Notifications" });
    const off = within(notifications).getByRole("button", { name: "Send test to first@example.com" }) as HTMLButtonElement;
    const on = within(notifications).getByRole("button", { name: "Send test to Sam" }) as HTMLButtonElement;
    expect(off.disabled).toBe(true);
    expect(off.title).toBe("Notifications are switched off for first@example.com");
    expect(on.disabled).toBe(false);
  });

  // REQ-160: each member's devices, which the admin can remove.
  it("lists each member's devices with a Remove on each", async () => {
    given({ signedIn: true, permissions: ["manage_members"] });
    render(await AdminPage());
    const sam = screen.getByRole("list", { name: "Devices for Sam" });
    expect(within(sam).getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      expect.stringContaining("iPhone, Safari"),
      expect.stringContaining("Mac, Chrome"),
    ]);
    expect(within(sam).getAllByRole("button", { name: "Remove" })).toHaveLength(2);
    expect(screen.queryByRole("list", { name: "Devices for first@example.com" })).toBeNull();
  });

  // REQ-22.
  const MINUTE = 60 * 1000;
  function entry(over: Record<string, unknown> = {}) {
    return {
      id: "log-1",
      sent_at: new Date(Date.now() - 30 * MINUTE).toISOString(),
      trigger: "hourly",
      user_id: "u2",
      device: "a1b2c3d4e5f6",
      delivered_at: null,
      tapped_at: null,
      accepted: true,
      failure_code: null,
      ...over,
    };
  }

  function logSection() {
    return screen.getByRole("region", { name: "Notification log" });
  }

  // The log is the least important thing on this page. If it fails, the
  // members table must still be there — otherwise one broken read takes
  // account management down with it.
  it("still shows the members when the log can't be read", async () => {
    given({ signedIn: true, permissions: ["manage_members"], logFails: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(await AdminPage());
    expect(screen.getAllByText("sam@example.com").length).toBeGreaterThan(0);
    expect(
      within(logSection()).getByText(/log could not be read/),
    ).toBeDefined();
  });

  // An unreadable log and an empty one mean opposite things, and saying
  // "nothing sent" when we simply could not look would be a lie.
  it("does not call an unreadable log an empty one", async () => {
    given({ signedIn: true, permissions: ["manage_members"], logFails: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(await AdminPage());
    expect(
      within(logSection()).queryByText(/Nothing sent in the last 7 days/),
    ).toBeNull();
  });

  it("says so plainly when nothing has been sent yet", async () => {
    given({ signedIn: true, permissions: ["manage_members"] });
    render(await AdminPage());
    expect(within(logSection()).getByText(/Nothing sent in the last 7 days/)).toBeDefined();
  });

  it("shows who a notification went to, and whether it arrived", async () => {
    given({
      signedIn: true,
      permissions: ["manage_members"],
      log: [
        entry({
          id: "log-1",
          delivered_at: new Date(Date.now() - 29 * MINUTE).toISOString(),
        }),
      ],
    });
    render(await AdminPage());
    const row = within(logSection()).getAllByRole("row")[1];
    expect(within(row).getByText("Sam")).toBeDefined();
    expect(within(row).getByText("Delivered")).toBeDefined();
    expect(within(row).getByText("Hourly test")).toBeDefined();
  });

  // Finances reminders (REQ-70) are their own kind, not "By hand".
  it("names a Finances reminder as one", async () => {
    given({ signedIn: true, permissions: ["manage_members"], log: [entry({ trigger: "finances" })] });
    render(await AdminPage());
    const row = within(logSection()).getAllByRole("row")[1];
    expect(within(row).getByText("Finances")).toBeDefined();
    expect(within(row).queryByText("By hand")).toBeNull();
  });

  // The whole point of the requirement: a send with no word back is a
  // failure worth seeing, not a blank.
  it("calls a send missing once five minutes have passed with no delivery", async () => {
    given({
      signedIn: true,
      permissions: ["manage_members"],
      log: [entry()],
    });
    render(await AdminPage());
    expect(within(logSection()).getByText("Missing")).toBeDefined();
  });

  it("calls a fresh send waiting, not missing", async () => {
    given({
      signedIn: true,
      permissions: ["manage_members"],
      log: [entry({ sent_at: new Date(Date.now() - MINUTE).toISOString() })],
    });
    render(await AdminPage());
    expect(within(logSection()).getByText("Waiting")).toBeDefined();
    expect(within(logSection()).queryByText("Missing")).toBeNull();
  });

  // The address a device is reached at never belongs on a screen.
  it("shows a device fingerprint, never its push address", async () => {
    given({
      signedIn: true,
      permissions: ["manage_members"],
      log: [entry()],
    });
    render(await AdminPage());
    const section = logSection();
    expect(within(section).getByText("a1b2c3d4e5f6")).toBeDefined();
    expect(section.textContent).not.toContain("web.push.apple.com");
  });
});
