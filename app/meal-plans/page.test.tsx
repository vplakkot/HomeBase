// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { searchRecipePages } from "../../lib/meal-plans/gemini";
import { readRecipePage } from "../../lib/meal-plans/recipe-search";
import { createClient } from "../../lib/supabase/server";
import { fakeSupabase } from "../../test/fake-supabase";
import EditRecipePage from "./[id]/edit/page";
import RecipePage from "./[id]/page";
import DraftPage from "./drafts/[id]/page";
import NewRecipePage from "./new/page";
import MealPlansPage from "./page";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../../lib/meal-plans/gemini", async (original) => ({
  ...(await original<typeof import("../../lib/meal-plans/gemini")>()),
  searchRecipePages: vi.fn(),
}));
vi.mock("../../lib/meal-plans/recipe-search", async (original) => ({
  ...(await original<typeof import("../../lib/meal-plans/recipe-search")>()),
  readRecipePage: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/meal-plans",
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

afterEach(cleanup);

// An invented recipe; nothing here is real.
const ID = "55555555-5555-4555-8555-555555555555";
const RECIPE = {
  id: ID,
  name: "Test pasta",
  photo: `${ID}/1.jpg`,
  video_url: "https://www.instagram.com/reel/example/",
  page_url: "https://recipes.example/pasta",
  cuisine: "Turkish",
  main_meat: "Beef",
  cooking_method: "Stove top",
  cook_minutes: 25,
  servings: 4,
  ingredients: [
    { quantity: "1", unit: "box", item: "pasta", note: "" },
    { quantity: "250", unit: "g", item: "Greek yogurt", note: "thinned with water" },
  ],
  steps: ["Boil 1 box pasta.", "Pour half the yogurt sauce (125 g) over the pasta."],
  notes: "Good cold too.",
  created_at: "2026-09-26T12:00:00Z",
};

function given(tables: Record<string, unknown[]>) {
  const fake = fakeSupabase({ permissions: ["use_modules"], tables });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
}

describe("a recipe card (REQ-110)", () => {
  it("shows the photo, links, facts, ingredients with quantities, steps and notes", async () => {
    given({ recipes: [RECIPE] });
    render(await RecipePage({ params: Promise.resolve({ id: ID }) }));
    // Under "Meal Plans", where you are: Recipes, not Overview.
    expect(screen.getByRole("heading", { level: 1 }).nextElementSibling?.textContent).toBe("Recipes");
    const card = screen.getByRole("article", { name: "Test pasta" });
    expect(within(card).getByRole("img", { name: "Test pasta" }).getAttribute("src")).toBe(`https://signed.example/${ID}/1.jpg`);
    expect(within(card).getByRole("link", { name: "Watch the video" }).getAttribute("href")).toBe(RECIPE.video_url);
    expect(within(card).getByRole("link", { name: "Recipe page" }).getAttribute("href")).toBe(RECIPE.page_url);
    for (const fact of ["Turkish", "Beef", "Stove top", "25 min", "4"]) expect(card.textContent).toContain(fact);
    const ingredients = within(within(card).getByRole("region", { name: "Ingredients" })).getAllByRole("listitem");
    expect(ingredients.map((item) => item.textContent)).toEqual(["1 box pasta", "250 g Greek yogurt (thinned with water)"]);
    const steps = within(within(card).getByRole("region", { name: "Steps" })).getAllByRole("listitem");
    expect(steps.map((item) => item.textContent)).toEqual(RECIPE.steps);
    expect(within(card).getByRole("region", { name: "Notes" }).textContent).toContain("Good cold too.");
    expect(within(card).getByRole("button", { name: "Remove this recipe" })).toBeTruthy();
  });
});

describe("where you are, under the module's name", () => {
  it("says Recipes on a recipe's Edit page, not Overview", async () => {
    given({ recipes: [RECIPE] });
    render(await EditRecipePage({ params: Promise.resolve({ id: ID }) }));
    expect(screen.getByRole("heading", { level: 1 }).nextElementSibling?.textContent).toBe("Recipes");
  });
});

describe("adding a recipe (REQ-111, REQ-112)", () => {
  it("offers a video (marked BETA), text in any form, or an empty card", async () => {
    given({});
    render(await NewRecipePage());
    expect(screen.getByRole("heading", { level: 1 }).nextElementSibling?.textContent).toBe("Recipes");
    const video = screen.getByRole("radio", { name: /From a video/ });
    expect(video.closest("label")?.textContent).toContain("BETA");
    fireEvent.click(screen.getByRole("radio", { name: "Paste or type it" }));
    expect(screen.getByRole("textbox", { name: "The recipe" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Fill in the card" }));
    expect(screen.getByRole("button", { name: "Save recipe" })).toBeTruthy();
  });
});

describe("reviewing a draft before it's saved (REQ-111, REQ-112)", () => {
  const draftRow = (extra: Record<string, unknown>) => ({
    id: ID,
    name: "Test curry",
    video_url: "https://www.tiktok.com/@someone/video/1",
    photo: null,
    status: "ready",
    error: null,
    seen: true,
    created_at: "2026-09-26T12:00:00Z",
    draft: {
      name: "",
      cuisine: "Thai",
      main_meat: "Chicken",
      cooking_method: "Stove top",
      cook_minutes: 20,
      servings: 2,
      ingredients: [{ quantity: "200", unit: "g", item: "chicken", note: "" }],
      steps: ["Fry 200 g chicken."],
      notes: null,
      guessed: ["cuisine", "cook_minutes"],
    },
    ...extra,
  });

  it("keeps the page link on a draft read from a page, and marks only video drafts BETA", async () => {
    given({ recipe_imports: [draftRow({ page_url: "https://curry.example.com/test-curry/", ai_generated: false })], cuisines: [] });
    render(await DraftPage({ params: Promise.resolve({ id: ID }) }));
    expect(screen.getByRole("heading", { name: /Test curry/ }).textContent).toBe("Test curry");
    expect((screen.getByRole("textbox", { name: /Recipe page/ }) as HTMLInputElement).value).toBe("https://curry.example.com/test-curry/");
    cleanup();
    given({ recipe_imports: [draftRow({ ai_generated: true, recipe_id: ID })], cuisines: [] });
    render(await DraftPage({ params: Promise.resolve({ id: ID }) }));
    expect(screen.getByRole("heading", { name: /Test curry/ }).textContent).toBe("Test curryAI-generated");
  });

  it("fills the form with the draft, marks what Gemini guessed, and keeps the video link (BETA)", async () => {
    given({ recipe_imports: [draftRow({})], cuisines: [{ name: "Thai" }] });
    render(await DraftPage({ params: Promise.resolve({ id: ID }) }));
    expect(screen.getByRole("heading", { name: /Test curry/ }).textContent).toContain("BETA");
    expect(screen.getByRole("heading", { level: 1 }).nextElementSibling?.textContent).toBe("Recipes");
    expect((screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("Test curry");
    expect(screen.getByText(/^Cuisine/).textContent).toContain("check this");
    expect(screen.getByText(/^Cook time/).textContent).toContain("check this");
    expect(screen.getByText(/^Servings/).textContent).not.toContain("check this");
    expect((screen.getByRole("textbox", { name: /Steps/ }) as HTMLTextAreaElement).value).toBe("Fry 200 g chicken.");
    expect((screen.getByRole("textbox", { name: /Video link/ }) as HTMLInputElement).value).toBe("https://www.tiktok.com/@someone/video/1");
    expect(screen.getByRole("button", { name: "Save recipe" })).toBeTruthy();
  });

  it("says plainly when the video couldn't be read, and offers the card to fill in or remove", async () => {
    given({ recipe_imports: [draftRow({ status: "failed", draft: null, error: "Gemini found no recipe in it." })], cuisines: [] });
    render(await DraftPage({ params: Promise.resolve({ id: ID }) }));
    expect(screen.getByRole("alert").textContent).toContain("Gemini couldn't read a recipe from this video. Gemini found no recipe in it.");
    expect((screen.getByRole("textbox", { name: /Steps/ }) as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Remove this draft" })).toBeTruthy();
  });

  it("shows a video still being read, with no form yet", async () => {
    given({ recipe_imports: [draftRow({ status: "processing", draft: null })], cuisines: [] });
    render(await DraftPage({ params: Promise.resolve({ id: ID }) }));
    expect(screen.getByText("Gemini is reading the video.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save recipe" })).toBeNull();
  });
});

describe("finding a recipe on the web (REQ-112, flows 2 and 3)", () => {
  it("searches by name, offers the pages it found with their sites and Google's suggestions, and picks none itself", async () => {
    given({});
    vi.mocked(searchRecipePages).mockResolvedValue({
      pages: [
        { url: "https://curry.example.com/test-curry/", site: "curry.example.com", title: "Test curry" },
        { url: "https://stews.example.org/curry.html", site: "stews.example.org", title: "Curry" },
      ],
      suggestions: "<div>chips</div>",
    });
    render(await NewRecipePage());
    fireEvent.click(screen.getByRole("radio", { name: "Find it on the web" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Test curry" } });
    fireEvent.click(screen.getByRole("button", { name: "Search the web" }));
    const pages = await screen.findByRole("group", { name: "Recipe pages for “Test curry”" });
    const choices = within(pages).getAllByRole("radio") as HTMLInputElement[];
    expect(choices.map((choice) => choice.closest("label")?.textContent)).toEqual([
      "Test currycurry.example.com",
      "Currystews.example.org",
    ]);
    expect(choices.some((choice) => choice.checked)).toBe(false);
    expect(screen.getByTitle("Google search suggestions").getAttribute("srcdoc")).toBe("<div>chips</div>");
    expect(screen.getByRole("button", { name: "Use this page" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "None of these: save it as Recipe missing" })).toBeTruthy();
  });

  it("adds from a recipe page link: the link alone, read by Gemini (REQ-150)", async () => {
    given({});
    render(await NewRecipePage());
    fireEvent.click(screen.getByRole("radio", { name: "From a recipe page link" }));
    expect(screen.getByRole("textbox", { name: /Link to the recipe page/ }).getAttribute("type")).toBe("url");
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    expect(screen.getByRole("button", { name: "Read the recipe" })).toBeTruthy();
  });

  it("when the page can't be read, says so and switches to typing it in, the link kept (REQ-150)", async () => {
    given({});
    vi.mocked(readRecipePage).mockRejectedValue(new Error("The page answered 403"));
    render(await NewRecipePage());
    fireEvent.click(screen.getByRole("radio", { name: "From a recipe page link" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Link to the recipe page/ }), {
      target: { value: "https://recipes.example.com/lemon-test-chicken/" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Read the recipe" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "That page couldn't be read. Copy the recipe from the site and paste it here.",
    );
    expect((screen.getByRole("radio", { name: "Paste or type it" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("Lemon test chicken");
    expect(screen.getByRole("textbox", { name: "The recipe" })).toBeTruthy();
    const kept = document.querySelector('input[type="hidden"][name="page_url"]') as HTMLInputElement;
    expect(kept.value).toBe("https://recipes.example.com/lemon-test-chicken/");
    expect(screen.getByRole("link", { name: "https://recipes.example.com/lemon-test-chicken/" })).toBeTruthy();
  });

  it("says so when nothing came up, and still offers to save it as Recipe missing", async () => {
    given({});
    vi.mocked(searchRecipePages).mockResolvedValue({ pages: [], suggestions: null });
    render(await NewRecipePage());
    fireEvent.click(screen.getByRole("radio", { name: "Find it on the web" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Test curry" } });
    fireEvent.click(screen.getByRole("button", { name: "Search the web" }));
    await waitFor(() => expect(screen.getByText("No recipe pages came up for “Test curry”.")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Use this page" })).toBeNull();
    expect(screen.getByRole("button", { name: "None of these: save it as Recipe missing" })).toBeTruthy();
  });

  it("shows Recipe missing on a card with no recipe, with Type it in and Have Gemini write one", async () => {
    given({ recipes: [{ ...RECIPE, ingredients: [], steps: [], ai_generated: false }] });
    render(await RecipePage({ params: Promise.resolve({ id: ID }) }));
    const missing = within(screen.getByRole("region", { name: "Recipe missing" }));
    expect(missing.getByRole("link", { name: "Type it in" }).getAttribute("href")).toBe(`/meal-plans/${ID}/edit`);
    expect(missing.getByRole("button", { name: "Have Gemini write one" })).toBeTruthy();
  });

  it("marks a card Gemini wrote as AI-generated, and a full card is never Recipe missing", async () => {
    given({ recipes: [{ ...RECIPE, ai_generated: true }] });
    render(await RecipePage({ params: Promise.resolve({ id: ID }) }));
    expect(screen.getByRole("heading", { name: /Test pasta/ }).textContent).toBe("Test pastaAI-generated");
    expect(screen.queryByRole("region", { name: "Recipe missing" })).toBeNull();
  });
});
