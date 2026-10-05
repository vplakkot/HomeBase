// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlannedControls } from "./plan-forms";
import { setPlanMeals } from "./plan-actions";

vi.mock("./plan-actions", () => ({
  addToPlan: vi.fn(),
  changePlanStart: vi.fn(),
  markDayOff: vi.fn(),
  moveEntry: vi.fn(),
  rateRecipe: vi.fn(),
  setPlanMeals: vi.fn(async () => ({})),
  startPlan: vi.fn(),
  unmarkDayOff: vi.fn(),
}));

afterEach(cleanup);

const controls = (meals: 1 | 2) => <PlannedControls planId="p" entryId="e" name="Chilli" meals={meals} />;
const picker = () => screen.getByRole("combobox", { name: "Size of Chilli" }) as HTMLSelectElement;

// REQ-176: the picker has to show what was saved, and a different pick has to save.
describe("the size picker (REQ-176)", () => {
  it("shows the saved size once the page comes back with it, and saves a different pick", async () => {
    vi.mocked(setPlanMeals).mockClear();
    const { rerender } = render(controls(1));
    expect(picker().value).toBe("1");
    // Pick 2 meals: it saves, then the page re-renders with the saved size.
    await act(async () => {
      fireEvent.change(picker(), { target: { value: "2" } });
    });
    expect(setPlanMeals).toHaveBeenCalledTimes(1);
    expect(vi.mocked(setPlanMeals).mock.calls[0][1].get("meals")).toBe("2");
    await act(async () => rerender(controls(2)));
    expect(picker().value).toBe("2");
    // And back to 1: that saves too.
    await act(async () => {
      fireEvent.change(picker(), { target: { value: "1" } });
    });
    expect(setPlanMeals).toHaveBeenCalledTimes(2);
    expect(vi.mocked(setPlanMeals).mock.calls[1][1].get("meals")).toBe("1");
    await act(async () => rerender(controls(1)));
    expect(picker().value).toBe("1");
  });
});
