// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PlanRange } from "./plan-range";

afterEach(cleanup);

const dish = (meal_on: string, meal: "lunch" | "dinner", meals: 1 | 2 = 2) => ({
  id: `${meal_on}${meal}`,
  recipe_id: "r",
  eating_out: false,
  meals,
  meal_on,
  meal,
  cooked: false,
  carry_over: false,
  didnt_cook: false,
  added_at: "",
});

// REQ-171: the dates in one short line, with a small Dinner or Lunch on each.
describe("a plan's dates (REQ-171)", () => {
  const text = (starts_meal: "lunch" | "dinner", recipes: ReturnType<typeof dish>[]) =>
    render(<PlanRange plan={{ starts_on: "2026-10-04", starts_meal, recipes }} />).container.textContent;

  it("reads first meal to last filled meal, leftovers included", () => {
    // Sun dinner and the leftovers at Mon lunch: "Sun, Oct 4 Dinner – Mon, Oct 5 Lunch".
    expect(text("dinner", [dish("2026-10-04", "dinner")])).toBe("Sun, Oct 4 Dinner – Mon, Oct 5 Lunch");
  });

  it("shows a plan starting at lunch with its Lunch marker", () => {
    expect(text("lunch", [dish("2026-10-04", "lunch", 1), dish("2026-10-10", "dinner", 1)])).toBe("Sun, Oct 4 Lunch – Sat, Oct 10 Dinner");
  });

  it("shows one date when the plan is empty or fits in its first meal", () => {
    expect(text("dinner", [])).toBe("Sun, Oct 4 Dinner");
    expect(text("dinner", [dish("2026-10-04", "dinner", 1)])).toBe("Sun, Oct 4 Dinner");
  });
});
