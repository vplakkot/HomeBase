// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Sidebar } from "./sidebar";

afterEach(cleanup);

function sidebar() {
  return screen.getByRole("navigation", { name: "Main" });
}

describe("the desktop sidebar", () => {
  it("starts with the brand, then Home", () => {
    render(<Sidebar current="home" canAdminister={false} />);
    const nav = sidebar();
    expect(nav.firstElementChild?.textContent).toBe("HomeBase");
    expect(within(nav).getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/");
  });

  it("lists all six modules, from the module list, in order", () => {
    render(<Sidebar current="home" canAdminister={false} />);
    const items = within(sidebar()).getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toEqual([
      "Finances",
      "Calendar, coming soon",
      "Pets, coming soon",
      "Wine, coming soon",
      "Meal Plans, coming soon",
      "Health, coming soon",
    ]);
  });

  // A decision of 2026-09-21: the other five are shown but can't be opened.
  it("links only Finances", () => {
    render(<Sidebar current="home" canAdminister={false} />);
    const links = within(sidebar()).getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(links).toEqual(["/", "/finances"]);
  });

  it("offers the admin console to admins, at the bottom", () => {
    render(<Sidebar current="home" canAdminister />);
    const console = within(sidebar()).getByRole("link", { name: "Admin console" });
    expect(console.getAttribute("href")).toBe("/admin");
    expect(sidebar().lastElementChild).toBe(console);
  });

  it("never shows members the admin console", () => {
    render(<Sidebar current="home" canAdminister={false} />);
    expect(within(sidebar()).queryByRole("link", { name: "Admin console" })).toBeNull();
  });

  it.each([
    ["home", "Home"],
    ["finances", "Finances"],
    ["admin", "Admin console"],
  ])("marks where you are: %s", (current, name) => {
    render(<Sidebar current={current} canAdminister />);
    const marked = within(sidebar())
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(marked.map((link) => link.textContent)).toEqual([name]);
  });
});
