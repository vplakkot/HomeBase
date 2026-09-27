"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission } from "../../lib/auth/permissions";
import { isPlanServings } from "../../lib/meal-plans/plan";
import { readRecipe } from "../../lib/meal-plans/recipes";
import { isFactor, scaleRecipe } from "../../lib/meal-plans/scale";
import { createClient } from "../../lib/supabase/server";

// Meal Plan batch 2: saving a scaled card (REQ-113), hiding a recipe
// (REQ-114), and the week's plan (REQ-115). Batch 3: closing a week,
// carrying a recipe over and rating (REQ-116).

export type PlanFormState = { error?: string };

const UUID = /^[0-9a-f-]{36}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

async function requireMember() {
  const supabase = await createClient();
  if (!(await hasPermission(supabase, "use_modules"))) redirect("/meal-plans");
  return supabase;
}

function idFrom(value: unknown): string | null {
  const id = String(value ?? "").trim();
  return UUID.test(id) ? id : null;
}

function dayFrom(value: unknown): string | null {
  const day = String(value ?? "").trim();
  return DAY.test(day) && !Number.isNaN(Date.parse(`${day}T12:00:00Z`)) ? day : null;
}

function refresh() {
  revalidatePath("/meal-plans", "layout");
  revalidatePath("/");
}

// REQ-113: the scaled amounts become the card's own. The browser sends
// only the ratio; the server scales the saved card itself, the same way.
export async function saveScaled(_prev: PlanFormState, formData: FormData): Promise<PlanFormState> {
  const supabase = await requireMember();
  const id = idFrom(formData.get("id"));
  const factor = Number(formData.get("factor"));
  if (!id) return { error: "That recipe is gone." };
  if (!isFactor(factor)) return { error: "Choose an amount between a twentieth and twenty times the recipe." };
  try {
    const recipe = await readRecipe(supabase, id);
    if (!recipe) return { error: "That recipe is gone." };
    const { error } = await supabase.from("recipes").update(scaleRecipe(recipe, factor)).eq("id", id);
    if (error) throw new Error(error.message);
  } catch (error) {
    Sentry.captureException(error);
    return { error: "The new amounts couldn't be saved. Try again." };
  }
  refresh();
  redirect(`/meal-plans/${id}`);
}

// REQ-114: hidden recipes leave the library but aren't deleted.
export async function setHidden(formData: FormData): Promise<void> {
  const supabase = await requireMember();
  const id = idFrom(formData.get("id"));
  if (!id) return;
  const { error } = await supabase.from("recipes").update({ hidden: formData.get("hidden") === "yes" }).eq("id", id);
  if (error) Sentry.captureException(new Error(error.message));
  refresh();
}

// REQ-115: either of us starts a plan on any day. REQ-116: starting one
// closes the open plan first, in the same step on the database.
export async function startPlan(_prev: PlanFormState, formData: FormData): Promise<PlanFormState> {
  const supabase = await requireMember();
  const startsOn = dayFrom(formData.get("starts_on"));
  if (!startsOn) return { error: "Choose the day the plan starts." };
  const { error } = await supabase.rpc("start_meal_plan", { p_starts_on: startsOn });
  // The database allows one open plan; the other person may have just started it.
  if (error?.code === "23505") return { error: "A plan was just started. Refresh to see it." };
  if (error) {
    Sentry.captureException(new Error(error.message));
    return { error: "The plan couldn't be started. Try again." };
  }
  refresh();
  // From Home's quick add (REQ-118): straight to the new plan.
  if (formData.get("then") === "week") redirect("/meal-plans/week");
  return {};
}

export async function changePlanStart(_prev: PlanFormState, formData: FormData): Promise<PlanFormState> {
  const supabase = await requireMember();
  const id = idFrom(formData.get("plan_id"));
  const startsOn = dayFrom(formData.get("starts_on"));
  if (!id) return { error: "That plan is gone." };
  if (!startsOn) return { error: "Choose the day the plan starts." };
  const { error } = await supabase.from("meal_plans").update({ starts_on: startsOn }).eq("id", id).is("closed_at", null);
  if (error) {
    Sentry.captureException(new Error(error.message));
    return { error: "The start day couldn't be changed. Try again." };
  }
  refresh();
  return {};
}

// Nothing is stuck: a plan started by mistake can go, with its recipes.
export async function removePlan(formData: FormData): Promise<void> {
  const supabase = await requireMember();
  const id = idFrom(formData.get("plan_id"));
  if (!id) return;
  const { error } = await supabase.from("meal_plans").delete().eq("id", id);
  if (error) Sentry.captureException(new Error(error.message));
  refresh();
}

// REQ-116: closing counts everything cooked except what's carried over,
// and asks each of us to rate the dishes cooked for the first time.
export async function closePlan(formData: FormData): Promise<void> {
  const supabase = await requireMember();
  const id = idFrom(formData.get("plan_id"));
  if (!id) return;
  const { error } = await supabase.rpc("close_meal_plan", { p_plan: id });
  if (error) Sentry.captureException(new Error(error.message));
  refresh();
}

// Nothing is stuck: the plan just closed can open again.
export async function reopenPlan(formData: FormData): Promise<void> {
  const supabase = await requireMember();
  const id = idFrom(formData.get("plan_id"));
  if (!id) return;
  const { error } = await supabase.rpc("reopen_meal_plan", { p_plan: id });
  if (error) Sentry.captureException(new Error(error.message));
  refresh();
}

// Adding a recipe is what counts it as planned (REQ-115): its times
// planned and date last planned are read from these rows.
export async function addToPlan(_prev: PlanFormState, formData: FormData): Promise<PlanFormState> {
  const supabase = await requireMember();
  const planId = idFrom(formData.get("plan_id"));
  const recipeId = idFrom(formData.get("recipe_id"));
  const servings = Number(formData.get("servings") ?? 4);
  if (!planId) return { error: "Start a plan first." };
  if (!recipeId) return { error: "Choose a recipe to add." };
  if (!isPlanServings(servings)) return { error: "A recipe is 4 servings or 2." };
  const { error } = await supabase.from("meal_plan_recipes").insert({ plan_id: planId, recipe_id: recipeId, servings });
  if (error?.code === "23505") return { error: "That recipe is already in the plan." };
  if (error) {
    Sentry.captureException(new Error(error.message));
    return { error: "The recipe couldn't be added. Try again." };
  }
  refresh();
  return {};
}

function plannedFrom(formData: FormData) {
  const planId = idFrom(formData.get("plan_id"));
  const recipeId = idFrom(formData.get("recipe_id"));
  return planId && recipeId ? { planId, recipeId } : null;
}

async function changePlanned(formData: FormData, change: { servings?: number; cooked?: boolean; carry_over?: boolean } | "remove") {
  const supabase = await requireMember();
  const row = plannedFrom(formData);
  if (!row) return;
  const table = supabase.from("meal_plan_recipes");
  const query = change === "remove" ? table.delete() : table.update(change);
  const { error } = await query.eq("plan_id", row.planId).eq("recipe_id", row.recipeId);
  if (error) Sentry.captureException(new Error(error.message));
  refresh();
}

export async function setPlanServings(formData: FormData): Promise<void> {
  const servings = Number(formData.get("servings"));
  if (isPlanServings(servings)) await changePlanned(formData, { servings });
}

// REQ-115: ticking a recipe cooked is optional. Cooked and carried over
// rule each other out.
export async function setCooked(formData: FormData): Promise<void> {
  const cooked = formData.get("cooked") === "yes";
  await changePlanned(formData, cooked ? { cooked, carry_over: false } : { cooked });
}

// REQ-116: a recipe we didn't get to moves to the next plan.
export async function setCarryOver(formData: FormData): Promise<void> {
  const carry = formData.get("carry_over") === "yes";
  await changePlanned(formData, carry ? { carry_over: true, cooked: false } : { carry_over: false });
}

export async function takeOffPlan(formData: FormData): Promise<void> {
  await changePlanned(formData, "remove");
}

async function signedInId(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string> {
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/sign-in");
  return userId;
}

// REQ-116: 1 to 5 stars, your own only. Rating again replaces it, and
// rating answers the question asked when the plan closed.
export async function rateRecipe(_prev: PlanFormState, formData: FormData): Promise<PlanFormState> {
  const supabase = await requireMember();
  const recipeId = idFrom(formData.get("recipe_id"));
  const stars = Number(formData.get("stars"));
  if (!recipeId) return { error: "That recipe is gone." };
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return { error: "Choose 1 to 5 stars." };
  const userId = await signedInId(supabase);
  const { error } = await supabase
    .from("recipe_ratings")
    .upsert({ recipe_id: recipeId, user_id: userId, stars }, { onConflict: "recipe_id,user_id" });
  if (error) {
    Sentry.captureException(new Error(error.message));
    return { error: "The rating couldn't be saved. Try again." };
  }
  refresh();
  return {};
}

// A rating given by mistake can be taken back (never locked).
export async function clearRecipeRating(formData: FormData): Promise<void> {
  const supabase = await requireMember();
  const recipeId = idFrom(formData.get("recipe_id"));
  if (!recipeId) return;
  const userId = await signedInId(supabase);
  const { error } = await supabase.from("recipe_ratings").delete().eq("recipe_id", recipeId).eq("user_id", userId);
  if (error) Sentry.captureException(new Error(error.message));
  refresh();
}

// Skipping takes the question away; the card can still be rated later.
export async function skipRating(formData: FormData): Promise<void> {
  const supabase = await requireMember();
  const recipeId = idFrom(formData.get("recipe_id"));
  if (!recipeId) return;
  const userId = await signedInId(supabase);
  const { error } = await supabase.from("recipe_rating_prompts").delete().eq("recipe_id", recipeId).eq("user_id", userId);
  if (error) Sentry.captureException(new Error(error.message));
  refresh();
}
