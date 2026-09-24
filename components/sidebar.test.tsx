// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./sidebar";
import { TEST_ACCOUNT } from "../test/account";
import { installDialogStandIn } from "../test/dialog";

vi.mock("../app/sign-out/actions", () => ({ signOut: vi.fn() }));
vi.mock("../app/notifications/actions", () => ({ saveDevice: vi.fn() }));
beforeAll(installDialogStandIn);

afterEach(cleanup);

function sidebar() {
  return screen.getByRole("navigation", { name: "Main" });
}

describe("the desktop sidebar", () => {
  it("starts with the brand, then Home", () => {
    render(<Sidebar current="home" canAdminister={false} account={TEST_ACCOUNT} />);
    const nav = sidebar();
    expect(nav.firstElementChild?.textContent).toBe("HomeBase");
    expect(within(nav).getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/");
  });

  it("lists all eight modules, from the module list, in order", () => {
    render(<Sidebar current="home" canAdminister={false} account={TEST_ACCOUNT} />);
    const items = within(sidebar()).getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toEqual([
      "Finances",
      "Calendar, coming soon",
      "Pets, coming soon",
      "Wine, coming soon",
      "Meal Plans, coming soon",
      "Health, coming soon",
      "Paperwork",
      "Storage",
    ]);
  });

  // A decision of 2026-09-21: the other five are shown but can't be opened.
  it("links only the modules that open: Finances and Paperwork", () => {
    render(<Sidebar current="home" canAdminister={false} account={TEST_ACCOUNT} />);
    const links = within(sidebar()).getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(links).toEqual(["/", "/finances", "/paperwork", "/storage"]);
  });

  it("offers the admin console to admins, at the bottom", () => {
    render(<Sidebar current="home" canAdminister account={TEST_ACCOUNT} />);
    const console = within(sidebar()).getByRole("link", { name: "Admin console" });
    expect(console.getAttribute("href")).toBe("/admin");
    // Above your own Profile, Settings and Sign out.
    const bottom = sidebar().lastElementChild!;
    expect(bottom.firstElementChild).toBe(console);
  });

  // REQ-85: on a desktop, your account is three buttons at the bottom.
  it("ends with Profile, Settings and Sign out", () => {
    render(<Sidebar current="home" canAdminister={false} account={TEST_ACCOUNT} />);
    const bottom = sidebar().lastElementChild as HTMLElement;
    expect(within(bottom).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Profile",
      "Settings",
      "Sign out",
    ]);
  });

  it("shows who you are in Profile, and this device's notifications in Settings", () => {
    render(<Sidebar current="home" canAdminister={false} account={TEST_ACCOUNT} />);
    fireEvent.click(within(sidebar()).getByRole("button", { name: "Profile" }));
    expect(screen.getByRole("dialog", { name: "Profile" }).textContent).toContain(
      "Signed in as sam@example.com",
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(within(sidebar()).getByRole("button", { name: "Settings" }));
    const settings = screen.getByRole("dialog", { name: "Settings" });
    expect(within(settings).getByRole("heading", { name: "Notifications" })).toBeDefined();
    expect(within(settings).getByTestId("build-info").textContent).toBe("dev · local");
  });

  it("never shows members the admin console", () => {
    render(<Sidebar current="home" canAdminister={false} account={TEST_ACCOUNT} />);
    expect(within(sidebar()).queryByRole("link", { name: "Admin console" })).toBeNull();
  });

  it.each([
    ["home", "Home"],
    ["finances", "Finances"],
    ["admin", "Admin console"],
  ])("marks where you are: %s", (current, name) => {
    render(<Sidebar current={current} canAdminister account={TEST_ACCOUNT} />);
    const marked = within(sidebar())
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(marked.map((link) => link.textContent)).toEqual([name]);
  });
});
