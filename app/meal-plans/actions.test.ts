import { after } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  genericRecipe,
  openVideoUpload,
  recipeFromPage,
  recipeFromText,
  searchRecipePages,
  uploadProgress,
} from "../../lib/meal-plans/gemini";
import { readImage, readPage, readRecipePage } from "../../lib/meal-plans/recipe-search";
import { createClient } from "../../lib/supabase/server";
import { fakeSupabase } from "../../test/fake-supabase";
import {
  dismissImport,
  draftFromLink,
  draftFromPage,
  draftFromText,
  draftGeneric,
  findRecipePages,
  saveRecipeMissing,
  updateRecipe,
  myRecipeImports,
  removeRecipe,
  saveDraft,
  setDraftPhoto,
  setRecipePhoto,
  setDraftFrame,
  startImagesImport,
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
  readRecipePage: vi.fn(),
  readImage: vi.fn(),
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

describe("adding a recipe from images (REQ-157)", () => {
  const pictures = (count: number) => {
    const data = new FormData();
    for (let i = 0; i < count; i++) {
      data.append("image", jpeg(), "image.jpg");
      data.append("thumb", jpeg(), "thumb.jpg");
    }
    return data;
  };

  it("makes one processing import from all the images, named from what they show, and reads them after answering", async () => {
    given();
    const started = await startImagesImport(pictures(3));
    expect(started).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(on("recipe_imports")[0].insert).toHaveBeenCalledWith(expect.objectContaining({ name: "Recipe from images", status: "processing" }));
    expect(after).toHaveBeenCalledTimes(1);
    expect(openVideoUpload).not.toHaveBeenCalled();
  });

  it("needs at least one image, and no more than three", async () => {
    given();
    expect(await startImagesImport(pictures(0))).toEqual({ error: "Choose at least one image." });
    expect(await startImagesImport(pictures(4))).toEqual({ error: "Up to 3 images make one recipe." });
    expect(fake.from).not.toHaveBeenCalledWith("recipe_imports");
  });

  it("refuses what isn't a JPEG, a missing small copy, or too much together", async () => {
    given();
    const png = pictures(1);
    png.set("image", new Blob(["x"], { type: "image/png" }), "a.png");
    expect(await startImagesImport(png)).toEqual({ error: "Images are sent as JPEG, under 1 MB each." });
    const noThumb = new FormData();
    noThumb.append("image", jpeg(), "image.jpg");
    expect(await startImagesImport(noThumb)).toEqual({ error: "An image didn't arrive. Try again." });
    const big = new FormData();
    for (let i = 0; i < 3; i++) {
      big.append("image", new Blob([new Uint8Array(900 * 1024)], { type: "image/jpeg" }), "image.jpg");
      big.append("thumb", jpeg(), "thumb.jpg");
    }
    expect(await startImagesImport(big)).toEqual({ error: "Those images are too big together. Try fewer." });
    expect(fake.from).not.toHaveBeenCalledWith("recipe_imports");
  });

  it("lets nobody without the permission add from images", async () => {
    given({}, []);
    await expect(startImagesImport(pictures(1))).rejects.toThrow("REDIRECT:/meal-plans");
  });
});

describe("adding a recipe from a video (REQ-112, BETA)", () => {
  it("opens a one-time upload link at Google, hands the phone only that link, and picks no random still", async () => {
    given();
    const started = await startVideoImport(
      form({ name: "Test pasta", video_url: "https://www.tiktok.com/@someone/video/1", size: "1000", mime: "video/quicktime" }),
    );
    expect(started).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), uploadUrl: "https://upload.example/one-time" });
    expect(openVideoUpload).toHaveBeenCalledWith(1000, "video/quicktime", "Test pasta");
    expect(fake.storage.bucket.upload).not.toHaveBeenCalled();
    expect(on("recipe_imports")[0].insert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Test pasta",
        source: "video",
        status: "uploading",
        video_url: "https://www.tiktok.com/@someone/video/1",
        upload_url: "https://upload.example/one-time",
      }),
    );
    expect(after).not.toHaveBeenCalled();
  });

  // Vin, 2026-09-29: the video says what the dish is; no name is asked first.
  it("needs no name: it starts as 'Recipe from a video' until Gemini has read it", async () => {
    given();
    const started = await startVideoImport(form({ name: "", size: "1000", mime: "video/mp4" }));
    expect(started).toHaveProperty("uploadUrl");
    expect(on("recipe_imports")[0].insert).toHaveBeenCalledWith(expect.objectContaining({ name: "Recipe from a video", status: "uploading" }));
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

describe("adding a recipe from a web page link (REQ-150)", () => {
  const LINK = "https://recipes.example.com/2024/05/lemon-test-chicken/";
  const PAGE_TEXT = "Lemon test chicken: 200 g chicken. Fry it.";
  const FROM_PAGE = { ...DRAFT, name: "Lemon Test Chicken" };

  it("drafts the card from that page only, named from the page, with the link kept and the page's photo handed back", async () => {
    given();
    vi.mocked(readRecipePage).mockResolvedValue({ text: PAGE_TEXT, image: "https://img.example.com/chicken.jpg" });
    vi.mocked(recipeFromPage).mockResolvedValue({ draft: FROM_PAGE as never });
    vi.mocked(readImage).mockResolvedValue("data:image/jpeg;base64,cGlj");
    const result = await draftFromLink(`  ${LINK} `);
    expect(result).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), photo: "data:image/jpeg;base64,cGlj" });
    expect(readRecipePage).toHaveBeenCalledWith(LINK);
    expect(recipeFromPage).toHaveBeenCalledWith("", PAGE_TEXT);
    expect(readImage).toHaveBeenCalledWith("https://img.example.com/chicken.jpg");
    expect(on("recipe_imports")[0].insert).toHaveBeenCalledWith({
      id: (result as { id: string }).id,
      name: "Lemon Test Chicken",
      status: "ready",
      draft: FROM_PAGE,
      seen: true,
      page_url: LINK,
    });
    // A draft, not a card: it's reviewed first.
    expect(fake.from).not.toHaveBeenCalledWith("recipes");
  });

  it("names it from the link when the page gives no name, and still drafts it with no photo", async () => {
    given();
    vi.mocked(readRecipePage).mockResolvedValue({ text: PAGE_TEXT, image: null });
    vi.mocked(recipeFromPage).mockResolvedValue({ draft: DRAFT as never });
    expect(await draftFromLink(LINK)).toEqual({ id: expect.any(String), photo: null });
    expect(on("recipe_imports")[0].insert).toHaveBeenCalledWith(expect.objectContaining({ name: "Lemon test chicken" }));
    expect(readImage).not.toHaveBeenCalled();
  });

  it("a photo that can't be downloaded doesn't stop the draft", async () => {
    given();
    vi.mocked(readRecipePage).mockResolvedValue({ text: PAGE_TEXT, image: "https://img.example.com/gone.jpg" });
    vi.mocked(recipeFromPage).mockResolvedValue({ draft: FROM_PAGE as never });
    vi.mocked(readImage).mockRejectedValue(new Error("The page answered 404"));
    expect(await draftFromLink(LINK)).toEqual({ id: expect.any(String), photo: null });
  });

  it("when the page can't be read or has no recipe, says so, keeps nothing, and hands over the link to type it in", async () => {
    given();
    const typeIn = { url: LINK, name: "Lemon test chicken" };
    vi.mocked(readRecipePage).mockRejectedValue(new Error("The page answered 403"));
    expect(await draftFromLink(LINK)).toEqual({
      error: "That page couldn't be read. Copy the recipe from the site and paste it here.",
      typeIn,
    });
    vi.mocked(readRecipePage).mockResolvedValue({ text: "", image: null });
    expect(await draftFromLink(LINK)).toMatchObject({ typeIn });
    vi.mocked(readRecipePage).mockResolvedValue({ text: "Subscribe to read this recipe.", image: null });
    vi.mocked(recipeFromPage).mockResolvedValue({ error: "Gemini found no recipe in it." });
    expect(await draftFromLink(LINK)).toEqual({
      error: "Gemini found no recipe on that page. Copy it from the site and paste it here.",
      typeIn,
    });
    expect(fake.from).not.toHaveBeenCalledWith("recipe_imports");
  });

  it("when Gemini itself doesn't answer, asks to try again rather than switching", async () => {
    given();
    vi.mocked(readRecipePage).mockResolvedValue({ text: PAGE_TEXT, image: null });
    vi.mocked(recipeFromPage).mockRejectedValue(new Error("down"));
    expect(await draftFromLink(LINK)).toEqual({ error: "Gemini didn't answer. Try again." });
  });

  it("never reads an address that isn't a public web page", async () => {
    given();
    for (const link of ["", "recipes.example.com/x", "http://recipes.example.com/x", "https://localhost/x", "https://10.0.0.1/x"]) {
      expect(await draftFromLink(link)).toEqual({ error: "Paste the recipe page's link, starting with https://." });
    }
    expect(readRecipePage).not.toHaveBeenCalled();
  });

  it("lets either of us add recipes, and nobody without the permission", async () => {
    given({}, []);
    await expect(draftFromLink(LINK)).rejects.toThrow("REDIRECT:/meal-plans");
  });

  it("the recipe typed in instead keeps the page's link", async () => {
    given();
    vi.mocked(recipeFromText).mockResolvedValue({ draft: DRAFT as never });
    await expect(draftFromText({}, form({ name: "Lemon test chicken", recipe: PAGE_TEXT, page_url: LINK }))).rejects.toThrow(
      /^REDIRECT:\/meal-plans\/drafts\//,
    );
    expect(on("recipe_imports")[0].insert).toHaveBeenCalledWith(expect.objectContaining({ page_url: LINK, draft: DRAFT }));
  });

  it("keeps only a public web page as that link", async () => {
    given();
    vi.mocked(recipeFromText).mockResolvedValue({ draft: DRAFT as never });
    await expect(draftFromText({}, form({ name: "Test", recipe: "x", page_url: "javascript:alert(1)" }))).rejects.toThrow("REDIRECT");
    expect(on("recipe_imports")[0].insert).toHaveBeenCalledWith(expect.objectContaining({ page_url: null }));
  });

  it("puts the shrunk page photo on the draft, which saving makes the card's photo", async () => {
    given({ recipe_imports: [{ id: IMPORT, photo: null }] });
    expect(await setDraftPhoto(form({ import_id: IMPORT, photo: jpeg(), photo_thumb: jpeg() }))).toEqual({ saved: true });
    expect(fake.storage.bucket.upload).toHaveBeenCalledTimes(2);
    expect(on("recipe_imports").at(-1)!.update).toHaveBeenCalledWith({ photo: expect.stringMatching(new RegExp(`^imports/${IMPORT}/`)) });
  });

  it("never replaces a draft's photo, and refuses anything but a small JPEG", async () => {
    given({ recipe_imports: [{ id: IMPORT, photo: "imports/x/1.jpg" }] });
    expect(await setDraftPhoto(form({ import_id: IMPORT, photo: jpeg(), photo_thumb: jpeg() }))).toEqual({ saved: true });
    expect(fake.storage.bucket.upload).not.toHaveBeenCalled();
    const png = new Blob(["x"], { type: "image/png" });
    expect(await setDraftPhoto(form({ import_id: IMPORT, photo: png, photo_thumb: png }))).toEqual({ error: "Photos are sent as JPEG." });
  });
});

describe("saving a video draft with the photo chosen at review (REQ-156)", () => {
  const draftRow = { photo: null, recipe_id: null, ai_generated: false };
  const fields = { name: "Test curry", ingredients: "", steps: "Fry 200 g chicken." };

  it("makes the chosen frame the card's photo, and clears the candidates", async () => {
    given({ recipe_imports: [draftRow] });
    fake.storage.bucket.list.mockResolvedValue({ data: [{ name: "1.jpg" }, { name: "2.jpg" }], error: null });
    await expect(saveDraft({}, form({ ...fields, import_id: IMPORT, frame: "2" }))).rejects.toThrow(/^REDIRECT:\/meal-plans\//);
    expect(fake.storage.bucket.copy.mock.calls[0][0]).toBe(`imports/${IMPORT}/frames/2.jpg`);
    expect(fake.storage.bucket.copy.mock.calls[1][0]).toBe(`imports/${IMPORT}/frames/2-thumb.jpg`);
    const photo = fake.storage.bucket.copy.mock.calls[0][1];
    expect(on("recipes")[0].insert).toHaveBeenCalledWith(expect.objectContaining({ photo }));
    expect(fake.storage.bucket.remove).toHaveBeenCalled();
  });

  it("saves the card with no photo when 'No photo' is chosen, nothing random in its place", async () => {
    given({ recipe_imports: [draftRow] });
    await expect(saveDraft({}, form({ ...fields, import_id: IMPORT, frame: "" }))).rejects.toThrow(/^REDIRECT:/);
    expect(fake.storage.bucket.copy).not.toHaveBeenCalled();
    expect(on("recipes")[0].insert).toHaveBeenCalledWith(expect.objectContaining({ photo: null }));
  });

  it("says so, and saves nothing, when the chosen frame can't be kept", async () => {
    given({ recipe_imports: [draftRow] });
    fake.storage.bucket.copy.mockResolvedValue({ data: null, error: { message: "gone" } });
    expect(await saveDraft({}, form({ ...fields, import_id: IMPORT, frame: "1" }))).toEqual({
      error: "That photo couldn't be kept. Try again, or choose no photo.",
    });
    expect(fake.from).not.toHaveBeenCalledWith("recipes");
  });

  it("removes the candidates with a removed draft", async () => {
    given({ recipe_imports: [{ photo: null, gemini_file: null }] });
    fake.storage.bucket.list.mockResolvedValue({ data: [{ name: "1.jpg" }], error: null });
    await expect(dismissImport(form({ id: IMPORT }))).rejects.toThrow("REDIRECT:/meal-plans");
    expect(fake.storage.bucket.remove).toHaveBeenCalledWith([`imports/${IMPORT}/frames/1.jpg`, `imports/${IMPORT}/frames/1-thumb.jpg`]);
  });
});

describe("the frame the phone cuts for a video's photo (REQ-156)", () => {
  it("keeps it, with its small copy, beside the draft", async () => {
    given({ recipe_imports: [{ id: IMPORT, source: "video" }] });
    expect(await setDraftFrame(form({ import_id: IMPORT, frame: jpeg() }))).toEqual({ saved: true });
    expect(fake.storage.bucket.upload.mock.calls.map(([path]) => path)).toEqual([`imports/${IMPORT}/frames/1.jpg`, `imports/${IMPORT}/frames/1-thumb.jpg`]);
  });

  it("refuses a draft that isn't a video's, one that's gone, or a frame that isn't a small JPEG", async () => {
    given({ recipe_imports: [{ id: IMPORT, source: "images" }] });
    expect(await setDraftFrame(form({ import_id: IMPORT, frame: jpeg() }))).toEqual({ error: "That draft is gone." });
    given({ recipe_imports: [{ id: IMPORT, source: "video" }] });
    expect(await setDraftFrame(form({ import_id: IMPORT, frame: new Blob(["x"], { type: "image/png" }) }))).toEqual({ error: "That frame can't be used." });
    expect(await setDraftFrame(form({ import_id: IMPORT }))).toEqual({ error: "No frame came with it." });
    expect(fake.storage.bucket.upload).not.toHaveBeenCalled();
  });

  it("lets nobody without the permission add one", async () => {
    given({}, []);
    await expect(setDraftFrame(form({ import_id: IMPORT, frame: jpeg() }))).rejects.toThrow("REDIRECT:/meal-plans");
  });
});
