// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { installDialogStandIn } from "../test/dialog";
import { QuickAdd } from "./quick-add";

beforeAll(installDialogStandIn);
afterEach(cleanup);

function openSheets() {
  return [...document.querySelectorAll("dialog")].filter((dialog) => dialog.open);
}

describe.each(["bar", "buttons"] as const)("Quick add as %s", (variant) => {
  it("offers Expense, Event and Meal", () => {
    render(<QuickAdd variant={variant} />);
    const group = screen.getByRole("group", { name: "Quick add" });
    expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Expense",
      "Event",
      "Meal",
    ]);
  });

  // v0.2 builds the buttons, not the forms behind them (REQ-81).
  it.each([
    ["Expense", "Add an expense"],
    ["Event", "Add an event"],
    ["Meal", "Add a meal"],
  ])("opens a coming-soon sheet from %s", (label, title) => {
    render(<QuickAdd variant={variant} />);
    fireEvent.click(screen.getByRole("button", { name: label }));
    const [sheet] = openSheets();
    expect(openSheets()).toHaveLength(1);
    expect(within(sheet).getByRole("heading").textContent).toBe(title);
    expect(sheet.textContent).toContain("Coming soon");
  });
});
