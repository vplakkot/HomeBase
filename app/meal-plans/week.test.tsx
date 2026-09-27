// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import { fakeSupabase } from "../../test/fake-supabase";
import RecipePage from "./[id]/page";
import MealPlansPage from "./page";
import { addToPlan, saveScaled, setCooked, setHidden, setPlanServings, startPlan, takeOffPlan } from "./plan-actions";
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
  created_at: "2026-09-26T12:00:00Z",
};
const SECOND = { ...RECIPE, id: OTHER, name: "Test lentil soup", photo: null, main_meat: "Vegetarian", ingredients: [], steps: [] };

function given(tables: Record<string, unknown[]>) {
  const fake = fakeSupabase({ permissions: ["use_modules"], tables });
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
  fake.from.mockImplementation(() => ({ insert: vi.fn(() => Promise.resolve(duplicate)) }) as never);
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const openPlan = (recipes: unknown[]) => ({ id: PLAN, starts_on: "2026-09-27", meal_plan_recipes: recipes });
const planned = (recipe_id: string, servings: number, cooked = false) => ({ recipe_id, servings, cooked, added_at: `2026-09-27T1${servings}:00:00Z` });

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
    expect(screen.getByRole("button", { name: "Start a plan" })).toBeTruthy();
  });

  it("starts a plan on the chosen day, and says so when the other person already did", async () => {
    const fake = given({});
    expect(await startPlan({}, form({ starts_on: "2026-09-29" }))).toEqual({});
    expect(sent(fake, "meal_plans", "insert")).toEqual({ starts_on: "2026-09-29" });
    expect(await startPlan({}, form({ starts_on: "next week" }))).toHaveProperty("error");
    refusedAsDuplicate(fake);
    expect(await startPlan({}, form({ starts_on: "2026-09-29" }))).toEqual({ error: "A plan is already open. Refresh to see it." });
  });

  it("shows the shared plan's recipes, their servings and cooked ticks, and how far they carry us", async () => {
    given({ meal_plans: [openPlan([planned(ID, 4, true), planned(OTHER, 2)])], recipes: [RECIPE, SECOND] });
    render(await WeekPage());
    expect(screen.getByRole("heading", { name: "From Sun, Sep 27" })).toBeTruthy();
    // One 4-serving recipe and one 2-serving one: a day and a half.
    expect(screen.getByText("Covers you through at least Sun, Sep 27")).toBeTruthy();
    const rows = within(screen.getByRole("list", { name: "Recipes in the plan" })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect((screen.getByRole("combobox", { name: "Servings of Test chicken rice" }) as HTMLSelectElement).value).toBe("4");
    expect((screen.getByRole("combobox", { name: "Servings of Test lentil soup" }) as HTMLSelectElement).value).toBe("2");
    expect((screen.getByRole("checkbox", { name: "Test chicken rice cooked" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Test lentil soup cooked" }) as HTMLInputElement).checked).toBe(false);
  });

  it("adds a recipe at 4 servings by default, or 2, and never twice", async () => {
    const fake = given({});
    expect(await addToPlan({}, form({ plan_id: PLAN, recipe_id: ID, servings: "4" }))).toEqual({});
    expect(sent(fake, "meal_plan_recipes", "insert")).toEqual({ plan_id: PLAN, recipe_id: ID, servings: 4 });
    expect(await addToPlan({}, form({ plan_id: PLAN, recipe_id: ID, servings: "3" }))).toHaveProperty("error");
    refusedAsDuplicate(fake);
    expect(await addToPlan({}, form({ plan_id: PLAN, recipe_id: ID, servings: "4" }))).toEqual({ error: "That recipe is already in the plan." });
    given({ meal_plans: [openPlan([])], recipes: [RECIPE, { ...SECOND, hidden: true }] });
    render(await WeekPage());
    const picker = screen.getByRole("combobox", { name: "Recipe" });
    expect(within(picker).getAllByRole("option").map((option) => option.textContent)).toEqual(["Choose a recipe", "Test chicken rice"]);
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
    await setPlanServings(form({ plan_id: PLAN, recipe_id: ID, servings: "2" }));
    expect(sent(fake, "meal_plan_recipes", "update")).toEqual({ servings: 2 });
    fake = given({});
    await setCooked(form({ plan_id: PLAN, recipe_id: ID, cooked: "yes" }));
    expect(sent(fake, "meal_plan_recipes", "update")).toEqual({ cooked: true });
    fake = given({});
    await takeOffPlan(form({ plan_id: PLAN, recipe_id: ID }));
    expect(fake.from.mock.results.some((result) => vi.mocked(result.value.delete).mock.calls.length > 0)).toBe(true);
  });

  it("sums the plan up on Meal Plans' overview", async () => {
    given({ recipes: [RECIPE, SECOND], recipe_imports: [], meal_plans: [openPlan([planned(ID, 4), planned(OTHER, 4)])] });
    render(await MealPlansPage());
    const card = screen.getByRole("link", { name: /Covers you through at least Mon, Sep 28/ });
    expect(card.getAttribute("href")).toBe("/meal-plans/week");
    expect(card.textContent).toContain("Test chicken rice · Test lentil soup");
    expect(screen.getByRole("link", { name: /2 recipes/ }).getAttribute("href")).toBe("/meal-plans/recipes");
  });
});
