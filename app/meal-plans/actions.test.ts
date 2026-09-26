import { afterEach, describe, expect, it, vi } from "vitest";
import { recipeFromText, openVideoUpload, uploadProgress } from "../../lib/meal-plans/gemini";
import { createClient } from "../../lib/supabase/server";
import { fakeSupabase } from "../../test/fake-supabase";
import {
  dismissImport,
  draftFromText,
  myRecipeImports,
  removeRecipe,
  saveDraft,
  setRecipePhoto,
  startVideoImport,
  videoProgress,
} from "./actions";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../../lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("../../lib/meal-plans/gemini", () => ({
  recipeFromText: vi.fn(),
  openVideoUpload: vi.fn(async () => "https://upload.example/one-time"),
  deleteVideo: vi.fn(async () => {}),
  uploadProgress: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

// Invented ids and recipes; nothing here is real.
const IMPORT = "33333333-3333-4333-8333-333333333333";
const RECIPE = "44444444-4444-4444-8444-444444444444";
const DRAFT = { name: "", cuisine: "Thai", main_meat: "Chicken", cooking_method: "Stove top", cook_minutes: 20, servings: 2, ingredients: [], steps: ["Fry 200 g chicken."], notes: null, guessed: ["cuisine"] };

let fake: ReturnType<typeof fakeSupabase>;

function given(tables: Record<string, unknown[]> = {}, permissions = ["use_modules"]) {
  fake = fakeSupabase({ permissions, tables });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
}

function form(fields: Record<string, string | Blob>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const on = (table: string) =>
  fake.from.mock.calls
    .map(([name], index) => (name === table ? fake.from.mock.results[index].value : null))
    .filter(Boolean) as Record<string, ReturnType<typeof vi.fn>>[];

const jpeg = () => new Blob(["x"], { type: "image/jpeg" });

afterEach(() => vi.clearAllMocks());

describe("adding a recipe from text in any form (REQ-111)", () => {
  it("turns it into a draft to review, saving nothing as a recipe yet", async () => {
    given();
    vi.mocked(recipeFromText).mockResolvedValue({ draft: DRAFT as never });
    await expect(draftFromText({}, form({ name: "Test curry", recipe: "chicken, curry paste, fry it" }))).rejects.toThrow(
      /^REDIRECT:\/meal-plans\/drafts\/[0-9a-f-]{36}$/,
    );
    expect(recipeFromText).toHaveBeenCalledWith("Test curry", "chicken, curry paste, fry it");
    expect(on("recipe_imports")[0].insert).toHaveBeenCalledWith(expect.objectContaining({ name: "Test curry", status: "ready", draft: DRAFT }));
    expect(fake.from).not.toHaveBeenCalledWith("recipes");
  });

  it("says so when Gemini finds no recipe, and keeps nothing", async () => {
    given();
    vi.mocked(recipeFromText).mockResolvedValue({ error: "Gemini found no recipe in it." });
    expect(await draftFromText({}, form({ name: "Test", recipe: "hello" }))).toEqual({
      error: "Gemini found no recipe in it. Try again, or fill the card in yourself.",
    });
    expect(fake.from).not.toHaveBeenCalledWith("recipe_imports");
  });

  it("lets either of us add recipes, and nobody without the permission", async () => {
    given({}, []);
    await expect(draftFromText({}, form({ name: "Test", recipe: "x" }))).rejects.toThrow("REDIRECT:/meal-plans");
  });
});

describe("adding a recipe from a video (REQ-112, BETA)", () => {
  it("keeps the still, opens a one-time upload link at Google, and hands the phone only that link", async () => {
    given();
    const started = await startVideoImport(
      form({ name: "Test pasta", video_url: "https://www.tiktok.com/@someone/video/1", size: "1000", mime: "video/quicktime", photo: jpeg(), photo_thumb: jpeg() }),
    );
    expect(started).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), uploadUrl: "https://upload.example/one-time" });
    expect(openVideoUpload).toHaveBeenCalledWith(1000, "video/quicktime", "Test pasta");
    expect(fake.storage.bucket.upload).toHaveBeenCalledTimes(2);
    expect(on("recipe_imports")[0].insert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Test pasta",
        status: "uploading",
        video_url: "https://www.tiktok.com/@someone/video/1",
        upload_url: "https://upload.example/one-time",
      }),
    );
  });

  it("refuses a file that isn't a video, or one over 500 MB", async () => {
    given();
    expect(await startVideoImport(form({ name: "x", size: "10", mime: "image/png" }))).toEqual({ error: "That file isn't a video HomeBase can send." });
    expect(await startVideoImport(form({ name: "x", size: String(600 * 1024 * 1024), mime: "video/mp4" }))).toEqual({
      error: "That video is over 500 MB. Try a shorter one.",
    });
    expect(openVideoUpload).not.toHaveBeenCalled();
  });

  it("asks Google (from the server) how much arrived, while the video is still going", async () => {
    given({ recipe_imports: [{ id: IMPORT, upload_url: "https://upload.example/one-time", status: "uploading" }] });
    vi.mocked(uploadProgress).mockResolvedValue({ final: false, received: 8388608 });
    expect(await videoProgress(IMPORT)).toEqual({ received: 8388608 });
    expect(uploadProgress).toHaveBeenCalledWith("https://upload.example/one-time");
  });

  it("once the video has all arrived, marks it processing and reads it after answering", async () => {
    const { after } = await import("next/server");
    given({ recipe_imports: [{ id: IMPORT, upload_url: "https://upload.example/one-time", status: "uploading" }] });
    vi.mocked(uploadProgress).mockResolvedValue({ final: true, file: "files/abc123" });
    expect(await videoProgress(IMPORT)).toEqual({ done: true });
    const update = on("recipe_imports").find((query) => query.update.mock.calls.length > 0)!;
    expect(update.update).toHaveBeenCalledWith(expect.objectContaining({ status: "processing", gemini_file: "files/abc123", upload_url: null }));
    expect(update.eq).toHaveBeenCalledWith("status", "uploading");
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("won't check an import that isn't uploading", async () => {
    given({ recipe_imports: [{ id: IMPORT, upload_url: null, status: "ready" }] });
    expect(await videoProgress(IMPORT)).toEqual({ error: "That upload isn't one of ours." });
    expect(uploadProgress).not.toHaveBeenCalled();
  });

  it("gives up on an import left processing too long, so the toast can say so", async () => {
    const old = new Date(Date.now() - 11 * 60_000).toISOString();
    given({ recipe_imports: [{ id: IMPORT, name: "Test", status: "processing", seen: false, created_at: old }] });
    const [item] = await myRecipeImports();
    expect(item).toMatchObject({ status: "failed", error: "It stopped before finishing." });
    expect(on("recipe_imports").some((query) => query.update.mock.calls.length > 0)).toBe(true);
  });

  it("throws a draft away with its still", async () => {
    given({ recipe_imports: [{ photo: "imports/x/1.jpg", gemini_file: null }] });
    await expect(dismissImport(form({ id: IMPORT }))).rejects.toThrow("REDIRECT:/meal-plans");
    expect(fake.storage.bucket.remove).toHaveBeenCalledWith(["imports/x/1.jpg", "imports/x/1-thumb.jpg"]);
  });
});

describe("saving the reviewed card (REQ-110)", () => {
  const card = {
    import_id: IMPORT,
    name: "Test curry",
    cuisine: "Burmese",
    cooking_method: "Air fryer",
    quantity: "200",
    unit: "g",
    item: "chicken",
    note: "",
    steps: "Fry 200 g chicken.",
  };

  it("saves the recipe with the video's still as its photo, adds a new cuisine to the list, and drops the draft", async () => {
    given({ recipe_imports: [{ photo: "imports/x/1.jpg" }] });
    await expect(saveDraft({}, form(card))).rejects.toThrow(/^REDIRECT:\/meal-plans\/[0-9a-f-]{36}$/);
    expect(on("cuisines")[0].upsert).toHaveBeenCalledWith({ name: "Burmese" }, { onConflict: "name", ignoreDuplicates: true });
    expect(on("recipes")[0].insert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Test curry",
        cooking_method: "Air fryer",
        photo: "imports/x/1.jpg",
        ingredients: [{ quantity: "200", unit: "g", item: "chicken", note: "" }],
        steps: ["Fry 200 g chicken."],
      }),
    );
    expect(on("recipe_imports").some((query) => query.delete.mock.calls.length > 0)).toBe(true);
  });

  it("lets either of us replace the photo, removing the old one", async () => {
    given({ recipes: [{ photo: `${RECIPE}/1.jpg` }] });
    expect(await setRecipePhoto({}, form({ id: RECIPE, photo: jpeg(), photo_thumb: jpeg() }))).toEqual({ saved: true });
    expect(on("recipes")[1].update).toHaveBeenCalledWith({ photo: expect.stringMatching(new RegExp(`^${RECIPE}/\\d+\\.jpg$`)) });
    expect(fake.storage.bucket.remove).toHaveBeenCalledWith([`${RECIPE}/1.jpg`, `${RECIPE}/1-thumb.jpg`]);
  });

  it("removes a recipe added by mistake, photo and all", async () => {
    given({ recipes: [{ photo: `${RECIPE}/1.jpg` }] });
    await expect(removeRecipe(form({ id: RECIPE }))).rejects.toThrow("REDIRECT:/meal-plans");
    expect(on("recipes")[1].delete).toHaveBeenCalled();
    expect(fake.storage.bucket.remove).toHaveBeenCalled();
  });
});
