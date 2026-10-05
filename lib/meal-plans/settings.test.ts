import { describe, expect, it } from "vitest";
import { readSettings } from "./settings";

// A stand-in for the one query the reader makes.
const answering = (result: { data: unknown; error: { code?: string; message: string } | null }) =>
  ({ from: () => ({ select: () => ({ maybeSingle: async () => result }) }) }) as never;

describe("reading the Meal Plan settings (REQ-172)", () => {
  it("is off unless the household turned it on", async () => {
    expect(await readSettings(answering({ data: null, error: null }))).toEqual({ repeatRecipes: false });
    expect(await readSettings(answering({ data: { repeat_recipes: false }, error: null }))).toEqual({ repeatRecipes: false });
    expect(await readSettings(answering({ data: { repeat_recipes: true }, error: null }))).toEqual({ repeatRecipes: true });
  });

  it("is off, not an error, while the table that holds it doesn't exist yet", async () => {
    expect(await readSettings(answering({ data: null, error: { code: "PGRST205", message: "no table" } }))).toEqual({ repeatRecipes: false });
    expect(await readSettings(answering({ data: null, error: { code: "42P01", message: "no table" } }))).toEqual({ repeatRecipes: false });
  });

  it("still reports any other failure", async () => {
    await expect(readSettings(answering({ data: null, error: { code: "XX000", message: "boom" } }))).rejects.toThrow("boom");
  });
});
