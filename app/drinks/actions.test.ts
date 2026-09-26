import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import { fakeSupabase } from "../../test/fake-supabase";
import { addDrink, clearRating, rateDrink, removeDrink, updateDrink } from "./actions";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

// Invented ids; nothing here is real.
const DRINK = "11111111-1111-4111-8111-111111111111";

let fake: ReturnType<typeof fakeSupabase>;

function given(permissions = ["use_modules"], how = "bought", ratings: unknown[] = []) {
  fake = fakeSupabase({ permissions, tables: { drinks: [{ id: DRINK, how }], drink_ratings: ratings } });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const on = (table: string) =>
  fake.from.mock.calls
    .map(([name], index) => (name === table ? fake.from.mock.results[index].value : null))
    .filter(Boolean) as Record<string, ReturnType<typeof vi.fn>>[];

afterEach(() => vi.clearAllMocks());

describe("adding a drink by hand (REQ-37)", () => {
  it("saves one with only a name and how we got it, and opens it", async () => {
    given();
    await expect(addDrink({}, form({ name: "House red", how: "had_out" }))).rejects.toThrow(`REDIRECT:/drinks/${DRINK}`);
    expect(on("drinks")[0].insert).toHaveBeenCalledWith(expect.objectContaining({ name: "House red", producer: null }));
  });

  it("refuses one without a name", async () => {
    given();
    expect(await addDrink({}, form({ name: "", producer: "Someone" }))).toEqual({ error: "Give the drink a name." });
    expect(fake.from).not.toHaveBeenCalledWith("drinks");
  });

  it("is refused to someone who can't use modules", async () => {
    given([]);
    await expect(addDrink({}, form({ name: "House red", how: "bought" }))).rejects.toThrow("REDIRECT:/drinks");
  });

  it("changes a drink's details and removes one", async () => {
    given();
    await expect(updateDrink({}, form({ id: DRINK, name: "Renamed", how: "bought" }))).rejects.toThrow(`REDIRECT:/drinks/${DRINK}`);
    expect(on("drinks")[0].update).toHaveBeenCalledWith(expect.objectContaining({ name: "Renamed" }));
    await expect(removeDrink({}, form({ id: DRINK }))).rejects.toThrow("REDIRECT:/drinks");
    expect(on("drinks")[1].delete).toHaveBeenCalled();
  });
});

describe("rating a drink (REQ-29)", () => {
  it("saves whole stars and a comment as the signed-in person's own rating, replacing any before", async () => {
    given();
    expect(await rateDrink({}, form({ drinkId: DRINK, stars: "4", comment: "  great \n with lamb " }))).toEqual({ saved: true });
    const [ratings] = on("drink_ratings");
    expect(ratings.upsert).toHaveBeenCalledWith(
      { drink_id: DRINK, user_id: "user-1", stars: 4, comment: "great with lamb", buy_again: null },
      { onConflict: "drink_id,user_id" },
    );
  });

  it("takes whole stars from 1 to 5 only", async () => {
    given();
    for (const stars of ["0", "6", "3.5", ""]) {
      expect(await rateDrink({}, form({ drinkId: DRINK, stars }))).toEqual({ error: "Choose 1 to 5 stars." });
    }
  });

  it("keeps no comment when none is given, and refuses one longer than a line", async () => {
    given();
    await rateDrink({}, form({ drinkId: DRINK, stars: "2", comment: "   " }));
    expect(on("drink_ratings")[0].upsert.mock.calls[0][0]).toMatchObject({ comment: null });
    expect(await rateDrink({}, form({ drinkId: DRINK, stars: "2", comment: "x".repeat(201) }))).toMatchObject({
      error: expect.stringContaining("one short line"),
    });
  });

  it("clears only your own rating", async () => {
    given();
    expect(await clearRating({}, form({ drinkId: DRINK }))).toEqual({ saved: true });
    const [ratings] = on("drink_ratings");
    expect(ratings.delete).toHaveBeenCalled();
    expect(ratings.eq).toHaveBeenCalledWith("user_id", "user-1");
  });
});

describe("how we got it and buy again (REQ-35, REQ-36, REQ-34)", () => {
  it("saves each person's own buy-again answer with their rating, separate from the stars", async () => {
    given();
    await rateDrink({}, form({ drinkId: DRINK, stars: "3", buyAgain: "yes" }));
    await rateDrink({}, form({ drinkId: DRINK, stars: "5", buyAgain: "no" }));
    await rateDrink({}, form({ drinkId: DRINK, stars: "4", buyAgain: "" }));
    const answers = on("drink_ratings").map((query) => query.upsert.mock.calls[0][0]);
    expect(answers.map(({ stars, buy_again, user_id }) => [stars, buy_again, user_id])).toEqual([
      [3, true, "user-1"],
      [5, false, "user-1"],
      [4, null, "user-1"],
    ]);
  });

  it("doesn't rate a wine we only want to try", async () => {
    given(["use_modules"], "want_to_try");
    expect(await rateDrink({}, form({ drinkId: DRINK, stars: "4" }))).toEqual({
      error: "Change how we got it from Want to try before rating.",
    });
    expect(fake.from).not.toHaveBeenCalledWith("drink_ratings");
  });

  it("changes Want to try to Bought, keeping the drink", async () => {
    given(["use_modules"], "want_to_try");
    await expect(updateDrink({}, form({ id: DRINK, name: "Someday Barolo", how: "bought", price: "$40" }))).rejects.toThrow(
      `REDIRECT:/drinks/${DRINK}`,
    );
    expect(on("drinks")[0].update).toHaveBeenCalledWith(expect.objectContaining({ how: "bought", price: "$40" }));
  });

  it("won't move a drink someone has rated back to Want to try", async () => {
    given(["use_modules"], "bought", [{ drink_id: DRINK }]);
    expect(await updateDrink({}, form({ id: DRINK, name: "x", how: "want_to_try" }))).toEqual({
      error: "It has ratings, so we've had it. Clear the ratings first.",
    });
  });
});
