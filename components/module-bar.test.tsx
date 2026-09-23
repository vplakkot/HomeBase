// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { moduleBySlug } from "../lib/modules";
import { installDialogStandIn } from "../test/dialog";
import { ModuleBar } from "./module-bar";

beforeAll(installDialogStandIn);
afterEach(cleanup);

const finances = moduleBySlug("finances");

function bar() {
  return screen.getByRole("navigation", { name: "Finances navigation" });
}

function openSheet() {
  const open = [...document.querySelectorAll("dialog")].filter((dialog) => dialog.open);
  expect(open).toHaveLength(1);
  return open[0];
}

describe("the bar inside a module, on a phone", () => {
  it("has exactly Home, Sections and Modules", () => {
    render(<ModuleBar module={finances} />);
    const items = [...bar().children].map(
      (item) => item.getAttribute("aria-label") ?? item.textContent,
    );
    expect(items).toEqual(["Home", "Sections", "Other modules"]);
  });

  it("goes Home", () => {
    render(<ModuleBar module={finances} />);
    expect(within(bar()).getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/");
  });

  // The module switcher is an icon; its name is for screen readers.
  it("names the icon-only Modules button for screen readers", () => {
    render(<ModuleBar module={finances} />);
    expect(within(bar()).getByRole("button", { name: "Other modules" }).textContent).toBe("");
  });
});

describe("the Sections sheet", () => {
  it("lists the overview, then the module's seven sections, Monthly entry, Log payment, Income, Savings and Budget year open, the rest coming", () => {
    render(<ModuleBar module={finances} />);
    fireEvent.click(within(bar()).getByRole("button", { name: "Sections" }));
    const sheet = openSheet();
    const rows = within(sheet).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Overview",
      "Monthly entryBills, personal charges, One-time Payments",
      "Log paymentSeveral times a month",
      "IncomeConfirm paychecks, add ESPP, RSU, bonus",
      "SavingsVerdict and what you actually saved",
      "BalancesEnter and see trendsComing soon",
      "HistoryClosed months, read-onlyComing soon",
      "Budget yearSplit %, income sources and billsAdmin only",
    ]);
  });

  // A sheet isn't inside the bar that sets the module's colours, so it
  // has to set them itself, or "where you are" loses its colour.
  it("carries the module's colours into the sheet", () => {
    render(<ModuleBar module={finances} />);
    fireEvent.click(within(bar()).getByRole("button", { name: "Sections" }));
    const list = within(openSheet()).getByRole("list");
    expect(list.style.getPropertyValue("--module-quiet-ink")).toBe("var(--finances-quiet-ink)");
  });

  it("links the overview, where you are, and the sections that have a page", () => {
    render(<ModuleBar module={finances} />);
    fireEvent.click(within(bar()).getByRole("button", { name: "Sections" }));
    const links = within(openSheet()).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Overview", "/finances"],
      ["Monthly entryBills, personal charges, One-time Payments", "/finances/monthly-entry"],
      ["Log paymentSeveral times a month", "/finances/log-payment"],
      ["IncomeConfirm paychecks, add ESPP, RSU, bonus", "/finances/income"],
      ["SavingsVerdict and what you actually saved", "/finances/savings"],
      ["Budget yearSplit %, income sources and billsAdmin only", "/finances/budget-year"],
    ]);
    expect(links.map((link) => link.getAttribute("aria-current"))).toEqual(["page", null, null, null, null, null]);
  });

  it("marks a section as where you are when you're on its page", () => {
    render(<ModuleBar module={finances} current="Budget year" />);
    fireEvent.click(within(bar()).getByRole("button", { name: "Sections" }));
    const links = within(openSheet()).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("aria-current"))).toEqual([null, null, null, null, null, "page"]);
  });
});

// DESIGN.md §6: the module's most frequent action, pinned above the bar.
describe("the pinned action", () => {
  it("puts Log payment above the bar, except on its own page", () => {
    render(<ModuleBar module={finances} />);
    expect(screen.getByRole("link", { name: "Log payment" }).getAttribute("href")).toBe("/finances/log-payment");
    cleanup();
    render(<ModuleBar module={finances} current="Log payment" />);
    expect(screen.queryByRole("link", { name: "Log payment" })).toBeNull();
  });
});

describe("the module switcher", () => {
  it("lists all six modules, opening only Finances, the one you're in", () => {
    render(<ModuleBar module={finances} />);
    fireEvent.click(within(bar()).getByRole("button", { name: "Other modules" }));
    const sheet = openSheet();
    expect(within(sheet).getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      "Finances",
      "CalendarComing soon",
      "PetsComing soon",
      "WineComing soon",
      "Meal PlansComing soon",
      "HealthComing soon",
    ]);
    const links = within(sheet).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/finances"]);
    expect(links[0].getAttribute("aria-current")).toBe("page");
  });
});
