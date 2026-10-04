// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import { fakeSupabase } from "../../test/fake-supabase";
import RecipePage from "./[id]/page";
import MealPlansPage from "./page";
import {
  addToPlan,
  clearRecipeRating,
  closePlan,
  moveEntry,
  rateRecipe,
  removePlan,
  reopenPlan,
  saveScaled,
  setCarryOver,
  setCooked,
  setHidden,
  setPlanServings,
  skipRating,
  startPlan,
  takeOffPlan,
} from "./plan-actions";
import DraftPage from "./drafts/[id]/page";
import NewRecipePage from "./new/page";
import RecipesPage from "./recipes/page";
import WeekPage from "./week/page";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
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

// Invented recipes and plans; nothing here is real.
const ID = "55555555-5555-4555-8555-555555555555";
const OTHER = "66666666-6666-4666-8666-666666666666";
const PLAN = "77777777-7777-4777-8777-777777777777";
const RECIPE = {
  id: ID,
  name: "Test chicken rice",
  photo: `${ID}/1.jpg`,
  video_url: null,
  page_url: null,
  cuisine: "Turkish",
  main_meat: "Chicken",
  cooking_method: "Stove top",
  cook_minutes: 25,
  servings: 4,
  ingredients: [
    { quantity: "2", unit: "lb", item: "chicken thighs", note: "" },
    { quantity: "1 1/2", unit: "cups", item: "rice", note: "" },
  ],
  steps: ["Brown 2 lb chicken, then add 1 1/2 cups rice and cook 20 minutes."],
  notes: null,
  hidden: false,
  ai_generated: false,
  created_at: "2026-09-26T12:00:00Z",
};
const SECOND = { ...RECIPE, id: OTHER, name: "Test lentil soup", photo: null, main_meat: "Vegetarian", ingredients: [], steps: [] };

const PEOPLE = [
  { user_id: "user-1", name: "Test Alex", manages_budget: true },
  { user_id: "user-2", name: "Test Sam", manages_budget: false },
];

function given(tables: Record<string, unknown[]>) {
  const fake = fakeSupabase({ permissions: ["use_modules"], tables, people: PEOPLE });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
  return fake;
}

// What a write sent: the argument of the n-th call to `method` on any table.
function sent(fake: ReturnType<typeof fakeSupabase>, table: string, method: string) {
  const index = fake.from.mock.calls.findIndex(([name], i) => name === table && vi.mocked(fake.from.mock.results[i].value[method]).mock.calls.length > 0);
  return index === -1 ? undefined : vi.mocked(fake.from.mock.results[index].value[method]).mock.calls[0][0];
}

// A write the database refuses as a duplicate (Postgres' 23505).
function refusedAsDuplicate(fake: ReturnType<typeof fakeSupabase>) {
  const duplicate = { data: null, error: { code: "23505", message: "duplicate key value" } };
  const none = { eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) };
  fake.from.mockImplementation(() => ({ select: vi.fn(() => none), insert: vi.fn(() => Promise.resolve(duplicate)) }) as never);
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const AHEAD = "99999999-9999-4999-8999-999999999999";
const E1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const E2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const E3 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const openPlan = (recipes: unknown[]) => ({ id: PLAN, starts_on: "2026-09-27", ahead: false, meal_plan_recipes: recipes });
const aheadPlan = (recipes: unknown[] = []) => ({ id: AHEAD, starts_on: "2026-09-30", ahead: true, meal_plan_recipes: recipes });
// An entry in the plan; `position` is its place in the order.
const planned = (recipe_id: string | null, servings: number, cooked = false, carry_over = false, id = recipe_id === ID ? E1 : E2, position = id === E1 ? 1 : 2) => ({
  id,
  recipe_id,
  eating_out: recipe_id === null,
  servings,
  cooked,
  carry_over,
  position,
  added_at: `2026-09-27T1${servings}:00:00Z`,
});

describe("scaling a recipe (REQ-113)", () => {
  it("scales every ingredient and the amounts in the steps when the servings change", async () => {
    given({ recipes: [RECIPE] });
    render(await RecipePage({ params: Promise.resolve({ id: ID }) }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Servings" }), { target: { value: "6" } });
    const ingredients = within(screen.getByRole("region", { name: "Ingredients" })).getAllByRole("listitem");
    expect(ingredients.map((item) => item.textContent)).toEqual(["3 lb chicken thighs", "2 1/4 cups rice"]);
    expect(within(screen.getByRole("region", { name: "Steps" })).getByRole("listitem").textContent).toBe(
      "Brown 3 lb chicken, then add 2 1/4 cups rice and cook 20 minutes.",
    );
    expect((screen.getByRole("textbox", { name: "lb chicken thighs" }) as HTMLInputElement).value).toBe("3");
    expect(screen.getByRole("button", { name: "Save these amounts" })).toBeTruthy();
  });

  it("scales everything by the same ratio when the main meat changes", async () => {
    given({ recipes: [RECIPE] });
    render(await RecipePage({ params: Promise.resolve({ id: ID }) }));
    fireEvent.change(screen.getByRole("textbox", { name: "lb chicken thighs" }), { target: { value: "1" } });
    const ingredients = within(screen.getByRole("region", { name: "Ingredients" })).getAllByRole("listitem");
    expect(ingredients.map((item) => item.textContent)).toEqual(["1 lb chicken thighs", "3/4 cups rice"]);
    expect((screen.getByRole("spinbutton", { name: "Servings" }) as HTMLInputElement).value).toBe("2");
  });

  it("saves the scaled amounts as the card's own, worked out again on the server", async () => {
    const fake = given({ recipes: [RECIPE] });
    await expect(saveScaled({}, form({ id: ID, factor: "1.5" }))).rejects.toThrow(`REDIRECT:/meal-plans/${ID}`);
    expect(sent(fake, "recipes", "update")).toEqual({
      ingredients: [
        { quantity: "3", unit: "lb", item: "chicken thighs", note: "" },
        { quantity: "2 1/4", unit: "cups", item: "rice", note: "" },
      ],
      steps: ["Brown 3 lb chicken, then add 2 1/4 cups rice and cook 20 minutes."],
      servings: 6,
    });
  });

  it("refuses a ratio out of reason", async () => {
    given({ recipes: [RECIPE] });
    expect(await saveScaled({}, form({ id: ID, factor: "0" }))).toHaveProperty("error");
    expect(await saveScaled({}, form({ id: ID, factor: "50" }))).toHaveProperty("error");
  });
});

describe("the recipe library (REQ-114)", () => {
  it("shows recipes as photo cards with name, cuisine, meat, method and cook time", async () => {
    given({ recipes: [RECIPE, { ...SECOND, hidden: true }], meal_plan_recipes: [], cuisines: [{ name: "Turkish" }] });
    render(await RecipesPage({ searchParams: Promise.resolve({}) }));
    const link = screen.getByRole("link", { name: /Test chicken rice/ });
    expect(link.getAttribute("href")).toBe(`/meal-plans/${ID}`);
    expect(link.querySelector("img")?.getAttribute("src")).toBe(`https://signed.example/${ID}/1-thumb.jpg`);
    expect(link.textContent).toContain("Turkish · Chicken · Stove top · 25 min");
    expect(screen.queryByRole("link", { name: /Test lentil soup/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Hidden recipes (1)" }).getAttribute("href")).toBe("/meal-plans/recipes?hidden=yes");
    for (const name of ["Cuisine", "Main meat", "Method", "Cook time", "Sort"]) expect(screen.getByRole("combobox", { name })).toBeTruthy();
  });

  it("hides a recipe and brings it back, without deleting it", async () => {
    const fake = given({ recipes: [RECIPE] });
    await setHidden(form({ id: ID, hidden: "yes" }));
    expect(sent(fake, "recipes", "update")).toEqual({ hidden: true });
    expect(fake.from.mock.results.some((result) => vi.mocked(result.value.delete).mock.calls.length > 0)).toBe(false);
    render(await RecipePage({ params: Promise.resolve({ id: ID }) }));
    expect(screen.getByRole("button", { name: "Hide from the library" })).toBeTruthy();
    cleanup();
    given({ recipes: [{ ...RECIPE, hidden: true }] });
    render(await RecipePage({ params: Promise.resolve({ id: ID }) }));
    expect(screen.getByRole("button", { name: "Bring back to the library" })).toBeTruthy();
  });
});

describe("the week's plan (REQ-115)", () => {
  it("offers to start a plan on any day when none is open", async () => {
    given({ meal_plans: [], recipes: [RECIPE] });
    render(await WeekPage());
    expect(screen.getByLabelText("Starts on").getAttribute("type")).toBe("date");
    expect(screen.getByRole("button", { name: "New meal plan" })).toBeTruthy();
  });

  it("starts a plan on the chosen day, and says so when the other person just did", async () => {
    const fake = given({});
    expect(await startPlan({}, form({ starts_on: "2026-09-29" }))).toEqual({});
    expect(fake.rpc).toHaveBeenCalledWith("start_meal_plan", { p_starts_on: "2026-09-29" });
    expect(await startPlan({}, form({ starts_on: "next week" }))).toHaveProperty("error");
    fake.rpc.mockImplementation(async (fn: string) =>
      fn === "has_permission" ? { data: true, error: null } : ({ data: null, error: { code: "23505", message: "duplicate key value" } } as never),
    );
    expect(await startPlan({}, form({ starts_on: "2026-09-29" }))).toEqual({ error: "A plan was just started. Refresh to see it." });
  });

  it("shows the shared plan's recipes, their servings and cooked ticks, and how far they carry us", async () => {
    given({ meal_plans: [openPlan([planned(ID, 4, true), planned(OTHER, 2)])], recipes: [RECIPE, SECOND] });
    render(await WeekPage());
    expect(screen.getByRole("heading", { name: "From Sun, Sep 27" })).toBeTruthy();
    // A 4-serving dish is a dinner and the next lunch; a 2-serving one the dinner after.
    expect(screen.getByText("Covers through dinner, Mon, Sep 28")).toBeTruthy();
    // The start day is already the heading; changing it is folded away.
    expect(screen.getByText("Change the start day").closest("details")?.hasAttribute("open")).toBe(false);
    const rows = within(screen.getByRole("list", { name: "Recipes in the plan" })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toMatch(/^Dinner Sun · Lunch MonTest chicken rice/);
    expect(rows[1].textContent).toMatch(/^Dinner MonTest lentil soup/);
    expect((screen.getByRole("combobox", { name: "Servings of Test chicken rice" }) as HTMLSelectElement).value).toBe("4");
    expect((screen.getByRole("combobox", { name: "Servings of Test lentil soup" }) as HTMLSelectElement).value).toBe("2");
    expect((screen.getByRole("checkbox", { name: "Test chicken rice cooked" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Test lentil soup cooked" }) as HTMLInputElement).checked).toBe(false);
  });

  it("adds a recipe at 4 servings by default, or 2, and never twice", async () => {
    const fake = given({});
    expect(await addToPlan({}, form({ plan_id: PLAN, recipe_id: ID, servings: "4" }))).toEqual({});
    expect(sent(fake, "meal_plan_recipes", "insert")).toMatchObject({ plan_id: PLAN, recipe_id: ID, servings: 4, eating_out: false, position: 1 });
    expect(await addToPlan({}, form({ plan_id: PLAN, recipe_id: ID, servings: "3" }))).toHaveProperty("error");
    refusedAsDuplicate(fake);
    expect(await addToPlan({}, form({ plan_id: PLAN, recipe_id: ID, servings: "4" }))).toEqual({ error: "That recipe is already in the plan." });
    given({ meal_plans: [openPlan([])], recipes: [RECIPE, { ...SECOND, hidden: true }] });
    render(await WeekPage());
    const picker = screen.getByRole("combobox", { name: "Recipe" });
    expect(within(picker).getAllByRole("option").map((option) => option.textContent)).toEqual(["Choose a recipe", "Test chicken rice"]);
    expect(within(screen.getByRole("combobox", { name: "Meal" })).getAllByRole("option")[0].textContent).toBe("Next free meal");
    expect((screen.getByRole("combobox", { name: "Servings" }) as HTMLSelectElement).value).toBe("4");
  });

  it("counts a planned recipe on its card: times planned and date last planned", async () => {
    given({
      recipes: [RECIPE],
      meal_plans: [openPlan([planned(ID, 4)])],
      meal_plan_recipes: [
        { recipe_id: ID, meal_plans: { starts_on: "2026-09-13" } },
        { recipe_id: ID, meal_plans: { starts_on: "2026-09-27" } },
      ],
    });
    render(await RecipePage({ params: Promise.resolve({ id: ID }) }));
    const card = screen.getByRole("article", { name: "Test chicken rice" });
    expect(within(card).getByText("Times planned").nextElementSibling?.textContent).toBe("2");
    expect(within(card).getByText("Last planned").nextElementSibling?.textContent).toBe("Sun, Sep 27");
    expect(within(card).getByRole("link", { name: "In this week's plan" })).toBeTruthy();
  });

  it("offers Add to this week on a card that isn't in the open plan", async () => {
    given({ recipes: [RECIPE], meal_plans: [openPlan([])], meal_plan_recipes: [] });
    render(await RecipePage({ params: Promise.resolve({ id: ID }) }));
    expect(screen.getByRole("button", { name: "Add to this week" })).toBeTruthy();
    expect(screen.getByText("Last planned").nextElementSibling?.textContent).toBe("Never");
  });

  it("changes servings, ticks cooked and takes a recipe off", async () => {
    let fake = given({});
    await setPlanServings(form({ plan_id: PLAN, entry_id: E1, servings: "2" }));
    expect(sent(fake, "meal_plan_recipes", "update")).toEqual({ servings: 2 });
    fake = given({});
    await setCooked(form({ plan_id: PLAN, entry_id: E1, cooked: "yes" }));
    expect(sent(fake, "meal_plan_recipes", "update")).toEqual({ cooked: true, carry_over: false });
    fake = given({});
    await takeOffPlan(form({ plan_id: PLAN, entry_id: E1 }));
    expect(fake.from.mock.results.some((result) => vi.mocked(result.value.delete).mock.calls.length > 0)).toBe(true);
  });
});

describe("closing a week and rating (REQ-116)", () => {
  it("closes the plan in one step, on the database, which counts it cooked except what's carried over", async () => {
    const fake = given({});
    await closePlan(form({ plan_id: PLAN }));
    expect(fake.rpc).toHaveBeenCalledWith("close_meal_plan", { p_plan: PLAN });
  });

  it("marks a recipe carry over, which un-ticks cooked, and ticking cooked un-marks it", async () => {
    let fake = given({});
    await setCarryOver(form({ plan_id: PLAN, entry_id: E1, carry_over: "yes" }));
    expect(sent(fake, "meal_plan_recipes", "update")).toEqual({ carry_over: true, cooked: false });
    fake = given({});
    await setCarryOver(form({ plan_id: PLAN, entry_id: E1, carry_over: "no" }));
    expect(sent(fake, "meal_plan_recipes", "update")).toEqual({ carry_over: false });
    given({ meal_plans: [openPlan([planned(ID, 4, false, true)])], recipes: [RECIPE] });
    render(await WeekPage());
    expect((screen.getByRole("checkbox", { name: "Carry Test chicken rice over" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: "Close this plan" })).toBeTruthy();
  });

  it("offers Plan ahead, with no day to choose, while one is open", async () => {
    given({ meal_plans: [openPlan([])], recipes: [RECIPE] });
    render(await WeekPage());
    expect(screen.queryByLabelText("Next plan starts on")).toBeNull();
    expect(screen.getByRole("button", { name: "Plan ahead" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New meal plan" })).toBeNull();
  });

  it("can reopen the last plan closed, so a mistaken close isn't stuck", async () => {
    const fake = given({ meal_plans: [], recipes: [RECIPE] });
    await reopenPlan(form({ plan_id: PLAN }));
    expect(fake.rpc).toHaveBeenCalledWith("reopen_meal_plan", { p_plan: PLAN });
    given({ meal_plans: [], recipes: [RECIPE] });
    render(await WeekPage());
    expect(screen.queryByRole("button", { name: "Reopen the last plan" })).toBeNull();
  });

  it("asks the signed-in person to rate first-time dishes until they answer or skip", async () => {
    given({
      meal_plans: [],
      recipes: [RECIPE, SECOND],
      recipe_rating_prompts: [{ recipe_id: ID, created_at: "2026-09-27T20:00:00Z" }],
      recipe_imports: [],
    });
    render(await MealPlansPage());
    const prompts = screen.getByRole("region", { name: "Rate what we cooked" });
    expect(within(prompts).getByRole("link", { name: "Test chicken rice" })).toBeTruthy();
    expect(within(prompts).getAllByRole("radio")).toHaveLength(5);
    expect(within(prompts).getByRole("button", { name: "Skip rating Test chicken rice" })).toBeTruthy();
    cleanup();
    given({ meal_plans: [], recipes: [RECIPE], recipe_rating_prompts: [] });
    render(await WeekPage());
    expect(screen.queryByRole("region", { name: "Rate what we cooked" })).toBeNull();
  });

  it("saves a rating of 1 to 5 as the signed-in person's own, and skipping removes only their question", async () => {
    let fake = given({});
    expect(await rateRecipe({}, form({ recipe_id: ID, stars: "4" }))).toEqual({});
    expect(sent(fake, "recipe_ratings", "upsert")).toEqual({ recipe_id: ID, user_id: "user-1", stars: 4 });
    expect(await rateRecipe({}, form({ recipe_id: ID, stars: "6" }))).toHaveProperty("error");
    fake = given({});
    await skipRating(form({ recipe_id: ID }));
    const skipped = fake.from.mock.results[fake.from.mock.calls.findIndex(([name]) => name === "recipe_rating_prompts")].value;
    expect(skipped.delete).toHaveBeenCalled();
    expect(skipped.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("shows each person's rating on the card, and its owner changes or clears it there", async () => {
    given({
      recipes: [RECIPE],
      meal_plans: [],
      meal_plan_recipes: [],
      recipe_ratings: [
        { recipe_id: ID, user_id: "user-1", stars: 4 },
        { recipe_id: ID, user_id: "user-2", stars: 5 },
      ],
    });
    render(await RecipePage({ params: Promise.resolve({ id: ID }) }));
    const ratings = screen.getByRole("region", { name: "Ratings" });
    expect(within(ratings).getByText("Test Sam").nextElementSibling?.textContent).toBe("★★★★★");
    expect((within(ratings).getByRole("radio", { name: "4 stars" }) as HTMLInputElement).checked).toBe(true);
    expect(within(ratings).getByRole("button", { name: "Clear my rating" })).toBeTruthy();
    const fake = given({});
    await clearRecipeRating(form({ recipe_id: ID }));
    const cleared = fake.from.mock.results[fake.from.mock.calls.findIndex(([name]) => name === "recipe_ratings")].value;
    expect(cleared.delete).toHaveBeenCalled();
    expect(cleared.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("sorts the library by rating (REQ-114)", async () => {
    given({
      recipes: [RECIPE, SECOND],
      meal_plan_recipes: [],
      cuisines: [],
      recipe_ratings: [{ recipe_id: OTHER, user_id: "user-1", stars: 5 }],
    });
    render(await RecipesPage({ searchParams: Promise.resolve({ sort: "rating" }) }));
    const titles = screen.getAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("/meal-plans/") && link.textContent?.startsWith("Test"));
    expect(titles.map((link) => link.textContent?.split("Turkish")[0])).toEqual(["Test lentil soup", "Test chicken rice"]);
  });
});

describe("suggestions while planning (REQ-117)", () => {
  it("suggests recipes to add, labelled, without adding them, and Not now drops one for this visit", async () => {
    given({ meal_plans: [openPlan([planned(ID, 4)])], recipes: [RECIPE, SECOND], meal_plan_recipes: [] });
    render(await WeekPage({ searchParams: Promise.resolve({}) }));
    const list = screen.getByRole("region", { name: "Suggestions" });
    // The chicken rice is already in the plan, so only the soup is suggested.
    expect(within(list).queryByRole("link", { name: "Test chicken rice" })).toBeNull();
    expect(within(list).getByRole("link", { name: "Test lentil soup" })).toBeTruthy();
    // Nothing new to us planned lately, and no Turkish dish: it is the one to try.
    expect(within(list).getByText("Try something new")).toBeTruthy();
    expect(within(list).getByRole("button", { name: "Add" })).toBeTruthy();
    expect(within(list).getByRole("link", { name: "Not now: Test lentil soup" }).getAttribute("href")).toBe(`/meal-plans/week?skip=${OTHER}`);
    cleanup();
    given({ meal_plans: [openPlan([planned(ID, 4)])], recipes: [RECIPE, SECOND], meal_plan_recipes: [] });
    render(await WeekPage({ searchParams: Promise.resolve({ skip: OTHER }) }));
    expect(screen.queryByRole("region", { name: "Suggestions" })).toBeNull();
  });
});

describe("Meal Plans' home (REQ-118)", () => {
  // REQ-155: plain rows, a name and the meal it's for; no photos.
  it("lists the open plan's recipes as text rows with their meals, and how far they carry us", async () => {
    given({ recipes: [RECIPE, SECOND], recipe_imports: [], meal_plans: [openPlan([planned(ID, 4), planned(OTHER, 4)])] });
    render(await MealPlansPage());
    const week = screen.getByRole("region", { name: "This week" });
    expect(within(week).getByText("Covers through lunch, Tue, Sep 29")).toBeTruthy();
    const list = within(week).getByRole("list", { name: "Recipes in the plan" });
    expect(within(list).getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      "Test chicken riceDinner Sun · Lunch Mon",
      "Test lentil soupDinner Mon · Lunch Tue",
    ]);
    expect(within(list).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([`/meal-plans/${ID}`, `/meal-plans/${OTHER}`]);
    expect(list.querySelector("img")).toBeNull();
    expect(within(week).getByRole("link", { name: "Open the plan" }).getAttribute("href")).toBe("/meal-plans/week");
  });

  it("prompts us to start a plan when none is open", async () => {
    given({ recipes: [RECIPE], recipe_imports: [], meal_plans: [] });
    render(await MealPlansPage());
    const week = screen.getByRole("region", { name: "This week" });
    expect(within(week).getByText("What are we eating this week?")).toBeTruthy();
    expect(within(week).getByRole("button", { name: "New meal plan" })).toBeTruthy();
  });

  it("shows the most planned and top rated recipes, total recipes and number of cuisines", async () => {
    given({
      recipes: [RECIPE, SECOND, { ...SECOND, id: "88888888-8888-4888-8888-888888888888", name: "Test pho", cuisine: "Vietnamese" }],
      recipe_imports: [],
      meal_plans: [],
      meal_plan_recipes: [
        { plan_id: PLAN, recipe_id: ID, carry_over: false, meal_plans: { starts_on: "2026-09-13", closed_at: "2026-09-19T20:00:00Z" } },
        { plan_id: PLAN, recipe_id: ID, carry_over: false, meal_plans: { starts_on: "2026-09-20", closed_at: "2026-09-26T20:00:00Z" } },
      ],
      recipe_ratings: [{ recipe_id: OTHER, user_id: "user-1", stars: 5 }],
    });
    render(await MealPlansPage());
    const kitchen = screen.getByRole("region", { name: "Our kitchen" });
    const value = (label: string) => within(kitchen).getByText(label).nextElementSibling?.textContent;
    expect(value("Most planned")).toBe("Test chicken rice (2)");
    expect(value("Top rated")).toBe("Test lentil soup ★★★★★");
    expect(value("Recipes")).toBe("3");
    expect(value("Cuisines")).toBe("2");
  });
});

// REQ-155: the Add recipe button is on the module home and the recipes list,
// and nowhere else (header button and phone bar alike).
describe("where Add recipe shows (REQ-155)", () => {
  const addRecipe = () => screen.queryAllByRole("link", { name: "Add recipe" });

  it("shows on the module home and on the Recipes list", async () => {
    given({ recipes: [RECIPE], recipe_imports: [], meal_plans: [] });
    render(await MealPlansPage());
    expect(addRecipe().length).toBeGreaterThan(0);
    cleanup();
    given({ recipes: [RECIPE], recipe_imports: [], meal_plans: [] });
    render(await RecipesPage({ searchParams: Promise.resolve({}) }));
    expect(addRecipe().length).toBeGreaterThan(0);
  });

  it("is gone from the plan, a recipe card and the Add recipe screen itself", async () => {
    given({ recipes: [RECIPE], recipe_imports: [], meal_plans: [] });
    render(await WeekPage());
    expect(addRecipe()).toEqual([]);
    cleanup();
    given({ recipes: [RECIPE] });
    render(await RecipePage({ params: Promise.resolve({ id: ID }) }));
    expect(addRecipe()).toEqual([]);
    cleanup();
    given({});
    render(await NewRecipePage());
    expect(addRecipe()).toEqual([]);
    cleanup();
    given({
      recipe_imports: [{ id: ID, name: "Test curry", video_url: null, source: "video", photo: null, status: "ready", error: null, seen: true, created_at: "2026-09-30T12:00:00Z", draft: null }],
      cuisines: [],
    });
    render(await DraftPage({ params: Promise.resolve({ id: ID }) }));
    expect(addRecipe()).toEqual([]);
    expect(screen.getByRole("button", { name: "Save recipe" })).toBeTruthy();
  });
});

describe("a card with no photo (REQ-155, REQ-156)", () => {
  it("shows no empty colour block on the card or in the library", async () => {
    const bare = { ...RECIPE, photo: null };
    given({ recipes: [bare] });
    render(await RecipePage({ params: Promise.resolve({ id: ID }) }));
    expect(within(screen.getByRole("article", { name: "Test chicken rice" })).queryAllByRole("img")).toEqual([]);
    cleanup();
    given({ recipes: [bare], recipe_imports: [], meal_plans: [] });
    render(await RecipesPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("region", { name: "Recipes" }).querySelector("img")).toBeNull();
  });
});

// jsdom doesn't lay anything out, so the tile's two-line limit is checked
// where it is written.
describe("a long name in an Our kitchen tile (REQ-155)", () => {
  it("is held to two lines, then …", () => {
    const css = readFileSync(join(__dirname, "meal-plans.module.css"), "utf8");
    const rule = /\.stats dd \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("-webkit-line-clamp: 2");
    expect(rule).toContain("overflow: hidden");
  });
});

describe("the plan laid out by meal (REQ-164)", () => {
  const E4 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";

  it("shows a card per entry in meal order, an evening out as one, and a free lunch as not planned", async () => {
    given({
      meal_plans: [openPlan([planned(ID, 2), planned(null, 2, false, false, E3, 2), planned(OTHER, 4, false, false, E2, 3)])],
      recipes: [RECIPE, SECOND],
    });
    render(await WeekPage());
    const rows = within(screen.getByRole("list", { name: "Recipes in the plan" })).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent?.replace(/(Servings|Move|Take|Cooked|Carry|Up|Down|Remove|Eating out Move).*/, "").slice(0, 40))).toEqual([
      "Dinner SunTest chicken rice",
      "Lunch Mon · Not planned",
      "Dinner MonEating out",
      "Lunch Tue · Not planned",
      "Dinner Tue · Lunch WedTest lentil soup",
    ]);
    expect(screen.getByText("Covers through lunch, Wed, Sep 30")).toBeTruthy();
    // An evening out has no cooked or carry-over tick.
    expect(screen.queryByRole("checkbox", { name: /Eating out/ })).toBeNull();
  });

  it("adds an evening out as an entry with no recipe, taking one dinner", async () => {
    const fake = given({});
    expect(await addToPlan({}, form({ plan_id: PLAN, intent: "eating_out" }))).toEqual({});
    expect(sent(fake, "meal_plan_recipes", "insert")).toMatchObject({ plan_id: PLAN, recipe_id: null, eating_out: true, servings: 2, position: 1 });
  });

  it("puts a new entry after the last by default, and on the chosen meal when one is picked", async () => {
    let fake = given({ meal_plan_recipes: [planned(ID, 4), planned(OTHER, 2)] });
    await addToPlan({}, form({ plan_id: PLAN, intent: "recipe", recipe_id: "88888888-8888-4888-8888-888888888888", servings: "4" }));
    expect(sent(fake, "meal_plan_recipes", "insert")).toMatchObject({ position: 3 });
    expect(fake.rpc).not.toHaveBeenCalledWith("set_plan_order", expect.anything());
    // Dinner Sun · Lunch Mon (E1), Dinner Tue... slot 0 is the first dinner: the new one goes first.
    fake = given({ meal_plans: [{ starts_on: "2026-09-27" }], meal_plan_recipes: [planned(ID, 4), planned(OTHER, 2)] });
    await addToPlan({}, form({ plan_id: PLAN, intent: "eating_out", slot: "0" }));
    const call = fake.rpc.mock.calls.find(([name]) => name === "set_plan_order");
    expect(call?.[1]).toMatchObject({ p_plan: PLAN });
    const order = (call?.[1] as { p_order: string[] }).p_order;
    expect(order).toHaveLength(3);
    expect(order.slice(1)).toEqual([E1, E2]);
  });

  it("moves an entry one place up or down, or to a chosen meal, in one step on the database", async () => {
    let fake = given({ meal_plan_recipes: [planned(ID, 4), planned(OTHER, 2)] });
    await moveEntry(form({ plan_id: PLAN, entry_id: E2, step: "up" }));
    expect(fake.rpc).toHaveBeenCalledWith("set_plan_order", { p_plan: PLAN, p_order: [E2, E1] });
    fake = given({ meal_plans: [{ starts_on: "2026-09-27" }], meal_plan_recipes: [planned(ID, 4), planned(OTHER, 2), planned(null, 2, false, false, E3, 3)] });
    // The evening out to the first dinner: the others shift to fill.
    await moveEntry(form({ plan_id: PLAN, entry_id: E3, slot: "0" }));
    expect(fake.rpc).toHaveBeenCalledWith("set_plan_order", { p_plan: PLAN, p_order: [E3, E1, E2] });
    // Up from the top does nothing.
    fake = given({ meal_plan_recipes: [planned(ID, 4), planned(OTHER, 2)] });
    await moveEntry(form({ plan_id: PLAN, entry_id: E1, step: "up" }));
    expect(fake.rpc).not.toHaveBeenCalledWith("set_plan_order", expect.anything());
  });

  it("offers a meal picker and arrows on each card, and no dragging", async () => {
    given({ meal_plans: [openPlan([planned(ID, 4), planned(OTHER, 2)])], recipes: [RECIPE, SECOND] });
    render(await WeekPage());
    const picker = screen.getByRole("combobox", { name: "Move Test lentil soup to" });
    expect(within(picker).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Move to…",
      "Dinner Sun, Sep 27",
      "Lunch Mon, Sep 28",
      "Dinner Mon, Sep 28",
      "Lunch Tue, Sep 29",
    ]);
    expect((screen.getByRole("button", { name: "Move Test chicken rice up" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Move Test lentil soup down" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Move Test lentil soup up" })).toBeTruthy();
    expect(E4).toBeTruthy();
  });
});

describe("planning ahead (REQ-162)", () => {
  it("queues the next plan on the day after the current plan's last meal, and never closes anything", async () => {
    const fake = given({ meal_plans: [openPlan([planned(ID, 4), planned(OTHER, 2)])] });
    expect(await startPlan({}, form({ starts_on: "2030-01-01" }))).toEqual({});
    // Dinner Sun · Lunch Mon, then Dinner Mon: the last meal is on Monday.
    expect(fake.rpc).toHaveBeenCalledWith("start_meal_plan", { p_starts_on: "2026-09-29" });
    expect(fake.rpc).not.toHaveBeenCalledWith("close_meal_plan", expect.anything());
  });

  it("allows only one plan ahead", async () => {
    const fake = given({ meal_plans: [openPlan([]), aheadPlan()] });
    expect(await startPlan({}, form({}))).toEqual({ error: "There's already a plan ahead." });
    expect(fake.rpc).not.toHaveBeenCalledWith("start_meal_plan", expect.anything());
  });

  it("shows the plan ahead under the current plan, starting the day after its last meal, and offers no second", async () => {
    given({ meal_plans: [openPlan([planned(ID, 4)]), aheadPlan([planned(OTHER, 4, false, false, E3, 1)])], recipes: [RECIPE, SECOND] });
    render(await WeekPage());
    // The stored start (Sep 30) is not used: the current plan ends Monday lunch, so the next starts Tuesday.
    expect(screen.getByRole("heading", { name: "Next plan, from Tue, Sep 29" })).toBeTruthy();
    const next = within(screen.getByRole("region", { name: "Next plan" }));
    expect(next.getByRole("list", { name: "Entries in the next plan" })).toBeTruthy();
    expect(next.getByText("Covers through lunch, Wed, Sep 30")).toBeTruthy();
    // Its start isn't ours to change, and it can't be closed before it begins.
    expect(next.queryByText("Change the start day")).toBeNull();
    expect(next.queryByRole("button", { name: "Close this plan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Plan ahead" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New meal plan" })).toBeNull();
  });

  it("moves the plan ahead's start when the current plan's last meal moves", async () => {
    // The rows as they stand once the change is saved: one 2-serving dish.
    const fake = given({ meal_plans: [openPlan([planned(ID, 2)]), aheadPlan()] });
    await setPlanServings(form({ plan_id: PLAN, entry_id: E1, servings: "2" }));
    // One 2-serving dish ends on Sunday's dinner, so the next plan starts Monday.
    const update = fake.from.mock.calls.findIndex(([name], i) => name === "meal_plans" && vi.mocked(fake.from.mock.results[i].value.update).mock.calls.length > 0);
    expect(vi.mocked(fake.from.mock.results[update].value.update).mock.calls[0][0]).toEqual({ starts_on: "2026-09-28" });
  });

  it("makes the plan ahead the current plan when the current one is removed", async () => {
    const fake = given({});
    await removePlan(form({ plan_id: PLAN }));
    const promoted = fake.from.mock.results.some((result) => vi.mocked(result.value.update).mock.calls.some(([change]: [{ ahead?: boolean }?]) => change?.ahead === false));
    expect(promoted).toBe(true);
  });
});

describe("module home actions and suggestions (REQ-165)", () => {
  it("shows Add recipe and New meal plan side by side while there is no plan", async () => {
    given({ recipes: [RECIPE], recipe_imports: [], meal_plans: [] });
    render(await MealPlansPage());
    const actions = within(screen.getByRole("group", { name: "Start something" }));
    expect(actions.getByRole("link", { name: "Add recipe" }).getAttribute("href")).toBe("/meal-plans/new");
    expect(actions.getByRole("link", { name: "New meal plan" }).getAttribute("href")).toBe("/meal-plans/week");
  });

  it("swaps New meal plan for Plan ahead while a plan runs, and drops it once one is ahead", async () => {
    given({ recipes: [RECIPE], recipe_imports: [], meal_plans: [openPlan([planned(ID, 4)])] });
    render(await MealPlansPage());
    let actions = within(screen.getByRole("group", { name: "Start something" }));
    expect(actions.getByRole("link", { name: "Add recipe" })).toBeTruthy();
    expect(actions.getByRole("button", { name: "Plan ahead" })).toBeTruthy();
    expect(actions.queryByRole("link", { name: "New meal plan" })).toBeNull();
    cleanup();
    given({ recipes: [RECIPE], recipe_imports: [], meal_plans: [openPlan([planned(ID, 4)]), aheadPlan()] });
    render(await MealPlansPage());
    actions = within(screen.getByRole("group", { name: "Start something" }));
    expect(actions.getByRole("link", { name: "Add recipe" })).toBeTruthy();
    expect(actions.queryByRole("button", { name: "Plan ahead" })).toBeNull();
  });

  it("shows at most 3 suggestions", async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ ...SECOND, id: `${i}0000000-0000-4000-8000-000000000000`, name: `Test dish ${i}`, cuisine: null }));
    given({ meal_plans: [openPlan([])], recipes: many, meal_plan_recipes: [] });
    render(await WeekPage({ searchParams: Promise.resolve({}) }));
    expect(within(screen.getByRole("region", { name: "Suggestions" })).getAllByRole("listitem")).toHaveLength(3);
  });
});
