import * as Sentry from "@sentry/nextjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import { fakeSupabase } from "../../test/fake-supabase";
import { addDrink, clearRating, rateDrink, readLabel, removeDrink, setPhotos, updateDrink } from "./actions";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
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
    await expect(addDrink({}, form({ name: "House red", how: "had_out" }))).rejects.toThrow(/^REDIRECT:\/drinks\/[0-9a-f-]{36}$/);
    expect(on("drinks")[0].insert).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), name: "House red", producer: null }),
    );
    expect(fake.storage.bucket.upload).not.toHaveBeenCalled();
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
    expect(on("drinks").some((query) => query.delete.mock.calls.length > 0)).toBe(true);
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

describe("label photos (REQ-32, REQ-25, REQ-26)", () => {
  const jpeg = (size = 1000) => new Blob([new Uint8Array(size)], { type: "image/jpeg" });
  const withPhotos = (fields: Record<string, string>, back = false) => {
    const data = form(fields);
    data.append("front", jpeg(), "front.jpg");
    data.append("front_thumb", jpeg(100), "front-thumb.jpg");
    if (back) {
      data.append("back", jpeg(), "back.jpg");
      data.append("back_thumb", jpeg(100), "back-thumb.jpg");
    }
    return data;
  };
  const uploaded = () => fake.storage.bucket.upload.mock.calls.map(([path]) => path as string);

  it("keeps the front and back photos, and their small copies, with a scanned drink", async () => {
    given();
    await expect(addDrink({}, withPhotos({ name: "Reserva", how: "bought" }, true))).rejects.toThrow(/REDIRECT:\/drinks\//);
    const [row] = on("drinks")[0].insert.mock.calls[0] as [{ id: string; front_label: string; back_label: string }];
    expect(uploaded()).toEqual([row.front_label, row.front_label.replace(".jpg", "-thumb.jpg"), row.back_label, row.back_label.replace(".jpg", "-thumb.jpg")]);
    expect(row.front_label).toMatch(new RegExp(`^${row.id}/\\d+-front\\.jpg$`));
    expect(row.back_label).toMatch(new RegExp(`^${row.id}/\\d+-back\\.jpg$`));
  });

  it("refuses anything but a shrunk JPEG, and a back label without a front", async () => {
    given();
    const png = form({ name: "x", how: "bought" });
    png.append("front", new Blob(["x"], { type: "image/png" }));
    png.append("front_thumb", new Blob(["x"], { type: "image/png" }));
    expect(await addDrink({}, png)).toEqual({ error: "Photos are sent as JPEG." });
    const big = form({ name: "x", how: "bought" });
    big.append("front", jpeg(2 * 1024 * 1024));
    big.append("front_thumb", jpeg(100));
    expect(await addDrink({}, big)).toEqual({ error: "That photo is too big. Try again." });
    const backOnly = form({ name: "x", how: "bought" });
    backOnly.append("back", jpeg());
    backOnly.append("back_thumb", jpeg(100));
    expect(await addDrink({}, backOnly)).toEqual({ error: "Add the front label first." });
    expect(fake.storage.bucket.upload).not.toHaveBeenCalled();
  });

  it("saves nothing, and takes back what was uploaded, when a photo fails", async () => {
    given();
    fake.storage.bucket.upload
      .mockResolvedValueOnce({ data: { path: "a" }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "offline" } } as never);
    expect(await addDrink({}, withPhotos({ name: "x", how: "bought" }))).toEqual({ error: "The photo didn't upload: offline" });
    expect(fake.from).not.toHaveBeenCalledWith("drinks");
    expect(fake.storage.bucket.remove).toHaveBeenCalledWith([uploaded()[0]]);
  });

  it("adds photos to a drink saved without them, and replaces old ones, removing them", async () => {
    fake = fakeSupabase({
      permissions: ["use_modules"],
      tables: { drinks: [{ id: DRINK, front_label: `${DRINK}/1-front.jpg`, back_label: null }] },
    });
    vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
    const data = withPhotos({ id: DRINK });
    expect(await setPhotos({}, data)).toEqual({ saved: true });
    const update = on("drinks").find((query) => query.update.mock.calls.length > 0)!;
    expect(update.update).toHaveBeenCalledWith({ front_label: uploaded()[0], back_label: null });
    expect(fake.storage.bucket.remove).toHaveBeenCalledWith([`${DRINK}/1-front.jpg`, `${DRINK}/1-front-thumb.jpg`]);
  });

  it("removes a drink's photos with it", async () => {
    fake = fakeSupabase({
      permissions: ["use_modules"],
      tables: { drinks: [{ id: DRINK, front_label: `${DRINK}/1-front.jpg`, back_label: `${DRINK}/1-back.jpg` }] },
    });
    vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
    await expect(removeDrink({}, form({ id: DRINK }))).rejects.toThrow("REDIRECT:/drinks");
    expect(fake.storage.bucket.remove).toHaveBeenCalledWith([
      `${DRINK}/1-front.jpg`,
      `${DRINK}/1-front-thumb.jpg`,
      `${DRINK}/1-back.jpg`,
      `${DRINK}/1-back-thumb.jpg`,
    ]);
  });

  it("hands the photos to label reading, which finds nothing until the reader is connected", async () => {
    given();
    expect(await readLabel(withPhotos({}, true))).toEqual({ found: false, fields: {}, unsure: [] });
    expect(fake.storage.bucket.upload).not.toHaveBeenCalled();
  });
});

describe("tidying up photos", () => {
  it("reports photos it couldn't remove, instead of failing silently", async () => {
    fake = fakeSupabase({
      permissions: ["use_modules"],
      tables: { drinks: [{ id: DRINK, front_label: `${DRINK}/1-front.jpg`, back_label: null }] },
    });
    vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
    fake.storage.bucket.remove.mockResolvedValueOnce({ data: null, error: { message: "storage down" } } as never);
    await expect(removeDrink({}, form({ id: DRINK }))).rejects.toThrow("REDIRECT:/drinks");
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.objectContaining({ message: "Label photos left behind: storage down" }), expect.anything());
  });

  it("refuses photos for a drink that's no longer there, uploading nothing", async () => {
    fake = fakeSupabase({ permissions: ["use_modules"], tables: { drinks: [] } });
    vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
    const data = form({ id: DRINK });
    data.append("front", new Blob(["x"], { type: "image/jpeg" }));
    data.append("front_thumb", new Blob(["x"], { type: "image/jpeg" }));
    expect(await setPhotos({}, data)).toEqual({ error: "That drink isn't there any more." });
    expect(fake.storage.bucket.upload).not.toHaveBeenCalled();
  });
});
