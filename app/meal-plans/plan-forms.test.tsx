// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddToPlanForm, PlannedControls } from "./plan-forms";
import { addToPlan, setPlanMeals } from "./plan-actions";

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

// REQ-180: a new recipe is added by name, right in the plan's add control.
describe("adding a new recipe from the plan (REQ-180)", () => {
  const choices = { one: [], two: [] };

  it("offers New recipe even when there are no recipes yet, beside Eating out", () => {
    render(<AddToPlanForm planId="p" recipes={[]} choices={choices} />);
    expect(screen.getByRole("button", { name: "Add to plan" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Eating out" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add new recipe" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Recipe" })).toBeNull();
    // The meal and size chosen apply to a new recipe too.
    expect(screen.getByRole("combobox", { name: "Meal" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Size" })).toBeTruthy();
  });

  it("picks the recipe that already has that name, so one tap adds it", async () => {
    vi.mocked(addToPlan).mockResolvedValue({ error: "Chilli is already a recipe. Pick it from the list and add it.", existingId: "r2" });
    render(<AddToPlanForm planId="p" recipes={[{ id: "r1", name: "Soup" }, { id: "r2", name: "Chilli" }]} choices={choices} />);
    fireEvent.change(screen.getByPlaceholderText("Recipe name"), { target: { value: "chilli" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add to plan" }));
    });
    expect((screen.getByRole("combobox", { name: "Recipe" }) as HTMLSelectElement).value).toBe("r2");
    expect(screen.getByRole("alert").textContent).toContain("already a recipe");
  });
});

describe("one Add to plan button", () => {
  it("clears the list when a name is typed, and the name when a recipe is picked", () => {
    render(<AddToPlanForm planId="p" recipes={[{ id: "r1", name: "Soup" }]} choices={{ one: [], two: [] }} />);
    const list = () => screen.getByRole("combobox", { name: "Recipe" }) as HTMLSelectElement;
    const name = screen.getByPlaceholderText("Recipe name") as HTMLInputElement;
    fireEvent.change(list(), { target: { value: "r1" } });
    expect(list().value).toBe("r1");
    fireEvent.change(name, { target: { value: "Tacos" } });
    expect(list().value).toBe("");
    fireEvent.change(list(), { target: { value: "r1" } });
    expect(name.value).toBe("");
  });
});
