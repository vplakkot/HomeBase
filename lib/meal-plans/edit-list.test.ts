import { describe, expect, it } from "vitest";
import { amountChanged, moveRow, stepsToCheck } from "./edit-list";

const cumin = { quantity: "1", unit: "tsp", item: "ground cumin", note: "" };

describe("moveRow (REQ-181)", () => {
  it("moves a row up or down by one", () => {
    expect(moveRow(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveRow(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
  });
  it("leaves the list alone at either end", () => {
    expect(moveRow(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moveRow(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});

describe("amountChanged (REQ-181)", () => {
  it("is true when the quantity or unit differs from the saved one", () => {
    expect(amountChanged({ ...cumin, quantity: "2" }, cumin)).toBe(true);
    expect(amountChanged({ ...cumin, unit: "tbsp" }, cumin)).toBe(true);
  });
  it("is false when only the name or note changed, or the ingredient is new", () => {
    expect(amountChanged({ ...cumin, note: "toasted" }, cumin)).toBe(false);
    expect(amountChanged(cumin, cumin)).toBe(false);
    expect(amountChanged(cumin, undefined)).toBe(false);
  });
});

describe("stepsToCheck (REQ-181)", () => {
  const steps = ["Toast 1 tsp cumin in the oil", "Add the onions", "Stir in the remaining 1 tsp Cumin"];
  it("finds the steps that name a changed ingredient, by its whole name or last word", () => {
    expect([...stepsToCheck(steps, [cumin])]).toEqual([0, 2]);
  });
  it("finds none when nothing changed", () => {
    expect(stepsToCheck(steps, []).size).toBe(0);
  });
});
