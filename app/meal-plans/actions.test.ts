import { afterEach, describe, expect, it, vi } from "vitest";
import {
  genericRecipe,
  openVideoUpload,
  recipeFromPage,
  recipeFromText,
  searchRecipePages,
  uploadProgress,
} from "../../lib/meal-plans/gemini";
import { readPage } from "../../lib/meal-plans/recipe-search";
import { createClient } from "../../lib/supabase/server";
import { fakeSupabase } from "../../test/fake-supabase";
import {
  dismissImport,
  draftFromPage,
  draftFromText,
  draftGeneric,
  findRecipePages,
  saveRecipeMissing,
  updateRecipe,
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
vi.mock("../../lib/meal-plans/gemini", async (original) => ({
  isGeminiFile: (await original<typeof import("../../lib/meal-plans/gemini")>()).isGeminiFile,
  recipeFromText: vi.fn(),
  recipeFromPage: vi.fn(),
  genericRecipe: vi.fn(),
  searchRecipePages: vi.fn(),
  openVideoUpload: vi.fn(async () => "https://upload.example/one-time"),
  deleteVideo: vi.fn(async () => {}),
  uploadProgress: vi.fn(),
}));
vi.mock("../../lib/meal-plans/recipe-search", async (original) => ({
  ...(await original<typeof import("../../lib/meal-plans/recipe-search")>()),
  readPage: vi.fn(),
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
    given({ recipe_imports: [{ id: IMPORT, upload_url: "https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=x", status: "uploading" }] });
    vi.mocked(uploadProgress).mockResolvedValue({ final: false, received: 8388608 });
    expect(await videoProgress(IMPORT)).toEqual({ received: 8388608 });
    expect(uploadProgress).toHaveBeenCalledWith("https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=x");
  });

  it("once the video has all arrived, marks it processing and reads it after answering", async () => {
    const { after } = await import("next/server");
    given({ recipe_imports: [{ id: IMPORT, upload_url: "https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=x", status: "uploading" }] });
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
    given({ recipe_imports: [{ id: IMPORT, name: "Test", status: "processing", seen: false, created_at: old, updated_at: old }] });
    const [item] = await myRecipeImports();
    expect(item).toMatchObject({ status: "failed", error: "It stopped before finishing." });
    const update = on("recipe_imports").find((query) => query.update.mock.calls.length > 0)!;
    expect(update.eq).toHaveBeenCalledWith("status", "processing");
  });

  it("counts processing from when the upload finished, so a slow upload isn't failed as it starts being read", async () => {
    const started = new Date(Date.now() - 30 * 60_000).toISOString();
    const finished = new Date(Date.now() - 60_000).toISOString();
    given({ recipe_imports: [{ id: IMPORT, name: "Test", status: "processing", seen: false, created_at: started, updated_at: finished }] });
    const [item] = await myRecipeImports();
    expect(item.status).toBe("processing");
    expect(on("recipe_imports").some((query) => query.update.mock.calls.length > 0)).toBe(false);
  });

  it("won't take a file name from Google that isn't a file name", async () => {
    given({ recipe_imports: [{ id: IMPORT, upload_url: "https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=x", status: "uploading" }] });
    vi.mocked(uploadProgress).mockResolvedValue({ final: true, file: "../../models" });
    expect(await videoProgress(IMPORT)).toEqual({ error: "That upload isn't one of ours." });
    expect(on("recipe_imports").some((query) => query.update.mock.calls.length > 0)).toBe(false);
  });

  it("keeps no still when the upload can't start", async () => {
    given();
    vi.mocked(openVideoUpload).mockRejectedValueOnce(new Error("Gemini upload did not start: 503"));
    expect(await startVideoImport(form({ name: "Test", size: "1000", mime: "video/mp4", photo: jpeg(), photo_thumb: jpeg() }))).toEqual({
      error: "The upload couldn't start. Try again.",
    });
    expect(fake.storage.bucket.upload).not.toHaveBeenCalled();
    expect(fake.from).not.toHaveBeenCalledWith("recipe_imports");
  });

  it("won't use an upload link that isn't Google's", async () => {
    given({ recipe_imports: [{ id: IMPORT, upload_url: "https://elsewhere.example/steal", status: "uploading" }] });
    expect(await videoProgress(IMPORT)).toEqual({ error: "That upload isn't one of ours." });
    expect(uploadProgress).not.toHaveBeenCalled();
  });

  it("won't ask Google to delete a file name that isn't Google's", async () => {
    const { deleteVideo } = await import("../../lib/meal-plans/gemini");
    given({ recipe_imports: [{ photo: null, gemini_file: "../../models/x" }] });
    await expect(dismissImport(form({ id: IMPORT }))).rejects.toThrow("REDIRECT:/meal-plans");
    expect(deleteVideo).not.toHaveBeenCalled();
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

describe("finding the recipe on the web (REQ-112, flows 2 and 3)", () => {
  const PAGE = "https://recipes.example.com/test-curry/";

  it("searches by the dish's name and offers what it found, picking nothing", async () => {
    given();
    const pages = [{ url: PAGE, site: "recipes.example.com", title: "Test curry" }];
    vi.mocked(searchRecipePages).mockResolvedValue({ pages, suggestions: "<div>chips</div>" });
    expect(await findRecipePages("  Test curry ")).toEqual({ pages, suggestions: "<div>chips</div>" });
    expect(searchRecipePages).toHaveBeenCalledWith("Test curry");
    expect(fake.from).not.toHaveBeenCalledWith("recipes");
  });

  it("says so when the search fails, and offers to add it without a recipe", async () => {
    given();
    vi.mocked(searchRecipePages).mockRejectedValue(new Error("down"));
    expect(await findRecipePages("Test curry")).toEqual({ error: "Gemini didn't answer. Try again, or add it without a recipe." });
  });

  it("drafts the card from the picked page only, keeping the page and video links", async () => {
    given();
    vi.mocked(readPage).mockResolvedValue("Test curry: 200 g chicken. Fry it.");
    vi.mocked(recipeFromPage).mockResolvedValue({ draft: DRAFT as never });
    await expect(
      draftFromPage({}, form({ name: "Test curry", page_url: PAGE, video_url: "https://www.instagram.com/reel/x" })),
    ).rejects.toThrow(/^REDIRECT:\/meal-plans\/drafts\/[0-9a-f-]{36}$/);
    expect(recipeFromPage).toHaveBeenCalledWith("Test curry", "Test curry: 200 g chicken. Fry it.");
    expect(on("recipe_imports")[0].insert).toHaveBeenCalledWith(
      expect.objectContaining({ page_url: PAGE, video_url: "https://www.instagram.com/reel/x", draft: DRAFT, status: "ready" }),
    );
  });

  it("never reads an address that isn't a public web page", async () => {
    given();
    for (const page_url of ["http://recipes.example.com/x", "https://localhost/x", "https://10.0.0.1/x", ""]) {
      expect(await draftFromPage({}, form({ name: "Test curry", page_url }))).toEqual({
        error: "Pick one of the pages, or choose None of these.",
      });
    }
    expect(readPage).not.toHaveBeenCalled();
  });

  it("says plainly when the page can't be read or has no recipe, and keeps nothing", async () => {
    given();
    vi.mocked(readPage).mockRejectedValue(new Error("404"));
    expect((await draftFromPage({}, form({ name: "Test curry", page_url: PAGE }))).error).toMatch(/couldn't be opened/);
    vi.mocked(readPage).mockResolvedValue("A page about something else.");
    vi.mocked(recipeFromPage).mockResolvedValue({ error: "Gemini found no recipe in it." });
    expect(await draftFromPage({}, form({ name: "Test curry", page_url: PAGE }))).toEqual({
      error: "Gemini found no recipe in it. Pick another page, or choose None of these.",
    });
    expect(fake.from).not.toHaveBeenCalledWith("recipe_imports");
  });

  it("with no page picked, saves the card with its name and video link only", async () => {
    given();
    await expect(
      saveRecipeMissing({}, form({ name: "Test curry", video_url: "https://www.tiktok.com/@x/video/1" })),
    ).rejects.toThrow(/^REDIRECT:\/meal-plans\/[0-9a-f-]{36}$/);
    const inserted = on("recipes")[0].insert.mock.calls[0][0];
    expect(inserted).toMatchObject({ name: "Test curry", video_url: "https://www.tiktok.com/@x/video/1" });
    expect(Object.keys(inserted).sort()).toEqual(["id", "name", "video_url"]);
  });

  it("asks Gemini for a generic version of a Recipe missing card, as a draft marked AI-generated", async () => {
    given({ recipes: [{ name: "Test curry", video_url: null }] });
    vi.mocked(genericRecipe).mockResolvedValue({ draft: DRAFT as never });
    await expect(draftGeneric({}, form({ id: RECIPE }))).rejects.toThrow(/^REDIRECT:\/meal-plans\/drafts\//);
    expect(genericRecipe).toHaveBeenCalledWith("Test curry");
    expect(on("recipe_imports")[0].insert).toHaveBeenCalledWith(
      expect.objectContaining({ recipe_id: RECIPE, ai_generated: true, draft: DRAFT }),
    );
  });

  it("saving that draft fills in the same card and keeps it marked AI-generated", async () => {
    given({ recipe_imports: [{ photo: null, recipe_id: RECIPE, ai_generated: true }], recipes: [{ ingredients: [], steps: [] }] });
    await expect(saveDraft({}, form({ import_id: IMPORT, name: "Test curry", item: "chicken", steps: "Fry it." }))).rejects.toThrow(
      `REDIRECT:/meal-plans/${RECIPE}`,
    );
    const recipes = on("recipes").at(-1)!;
    expect(recipes.insert).not.toHaveBeenCalled();
    expect(recipes.update).toHaveBeenCalledWith(expect.objectContaining({ name: "Test curry", ai_generated: true }));
    expect(recipes.eq).toHaveBeenCalledWith("id", RECIPE);
  });

  it("won't overwrite a card that was typed in meanwhile, or one that's gone, and keeps the draft", async () => {
    const save = () => saveDraft({}, form({ import_id: IMPORT, name: "Test curry", item: "chicken", steps: "Fry it." }));
    given({ recipe_imports: [{ photo: null, recipe_id: RECIPE, ai_generated: true }], recipes: [{ ingredients: [], steps: ["Typed in."] }] });
    expect(await save()).toEqual({ error: "That card has a recipe now. Remove this draft, or edit the card instead." });
    given({ recipe_imports: [{ photo: null, recipe_id: RECIPE, ai_generated: true }], recipes: [] });
    expect(await save()).toEqual({ error: "That recipe is gone. Remove this draft." });
    expect(on("recipes").some((query) => query.update.mock.calls.length > 0)).toBe(false);
    expect(on("recipe_imports").some((query) => query.delete.mock.calls.length > 0)).toBe(false);
  });

  it("any edit clears AI-generated", async () => {
    given();
    await expect(updateRecipe({}, form({ id: RECIPE, name: "Test curry", item: "chicken", steps: "Fry it." }))).rejects.toThrow(
      `REDIRECT:/meal-plans/${RECIPE}`,
    );
    expect(on("recipes")[0].update).toHaveBeenCalledWith(expect.objectContaining({ ai_generated: false }));
  });
});
