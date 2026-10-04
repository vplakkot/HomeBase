// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDialogStandIn } from "../test/dialog";
import { QuickAdd } from "./quick-add";

vi.mock("../app/meal-plans/plan-actions", () => ({
  startPlan: vi.fn(async () => ({})),
  addToPlan: vi.fn(),
  changePlanStart: vi.fn(),
  rateRecipe: vi.fn(),
  setCarryOver: vi.fn(),
  setCooked: vi.fn(),
  setPlanServings: vi.fn(),
  moveEntry: vi.fn(),
}));

beforeAll(installDialogStandIn);
afterEach(cleanup);

function openSheets() {
  return [...document.querySelectorAll("dialog")].filter((dialog) => dialog.open);
}

describe.each(["bar", "buttons"] as const)("Quick add as %s", (variant) => {
  it("offers Expense, Event and New meal plan", () => {
    render(<QuickAdd variant={variant} today="2026-09-27" />);
    const group = screen.getByRole("group", { name: "Quick add" });
    expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Expense",
      "Event",
      "New meal plan",
    ]);
  });

  // v0.2 builds the buttons, not the forms behind them (REQ-81).
  it.each([
    ["Expense", "Add an expense"],
    ["Event", "Add an event"],
  ])("opens a coming-soon sheet from %s", (label, title) => {
    render(<QuickAdd variant={variant} today="2026-09-27" />);
    fireEvent.click(screen.getByRole("button", { name: label }));
    const [sheet] = openSheets();
    expect(openSheets()).toHaveLength(1);
    expect(within(sheet).getByRole("heading").textContent).toBe(title);
    expect(sheet.textContent).toContain("Coming soon");
  });

  // REQ-118: New meal plan starts a plan, then opens it.
  it("starts a meal plan from New meal plan, on today by default", () => {
    render(<QuickAdd variant={variant} today="2026-09-27" />);
    fireEvent.click(screen.getByRole("button", { name: "New meal plan" }));
    const [sheet] = openSheets();
    expect(within(sheet).getByRole("heading").textContent).toBe("Start a meal plan");
    expect((within(sheet).getByLabelText("Starts on") as HTMLInputElement).value).toBe("2026-09-27");
    expect(within(sheet).getByRole("button", { name: "New meal plan" })).toBeTruthy();
    expect((sheet.querySelector('input[name="then"]') as HTMLInputElement).value).toBe("week");
  });

  // REQ-162: with a plan running the button plans ahead, with no day to pick.
  it("offers Plan next week while a plan is running", () => {
    render(<QuickAdd variant={variant} today="2026-09-27" planAction="ahead" />);
    expect(screen.queryByRole("button", { name: "New meal plan" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Plan next week" }));
    const [sheet] = openSheets();
    expect(within(sheet).queryByLabelText("Starts on")).toBeNull();
    expect(within(sheet).getByRole("button", { name: "Plan next week" })).toBeTruthy();
    expect((sheet.querySelector('input[name="then"]') as HTMLInputElement).value).toBe("week");
  });

  it("offers neither once a plan and the one after it both exist", () => {
    render(<QuickAdd variant={variant} today="2026-09-27" planAction={null} />);
    const group = screen.getByRole("group", { name: "Quick add" });
    expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual(["Expense", "Event"]);
  });
});
