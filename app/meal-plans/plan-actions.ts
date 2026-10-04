"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission } from "../../lib/auth/permissions";
import { ENTRY_COLUMNS, isPlanServings, nextPlanStart, orderedFor, readStoredPlans, syncAheadStart, type PlannedRecipe } from "../../lib/meal-plans/plan";
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

// REQ-115: either of us starts a plan on any day. REQ-162: with one open,
// the new plan goes behind it and starts the day after its last meal, so
// the day asked for is ignored; it never closes anything.
export async function startPlan(_prev: PlanFormState, formData: FormData): Promise<PlanFormState> {
  const supabase = await requireMember();
  const { current, ahead } = await readStoredPlans(supabase);
  if (ahead) return { error: "There's already a plan ahead." };
  const startsOn = current ? nextPlanStart(current) : dayFrom(formData.get("starts_on"));
  if (!startsOn) return { error: "Choose the day the plan starts." };
  const { error } = await supabase.rpc("start_meal_plan", { p_starts_on: startsOn });
  // The database allows one current plan and one ahead; the other person may have just started it.
  if (error?.code === "23505") return { error: "A plan was just started. Refresh to see it." };
  if (error) {
    Sentry.captureException(new Error(error.message));
    return { error: "The plan couldn't be started. Try again." };
  }
  refresh();
  // From Home's quick add (REQ-118): straight to the plan.
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
  await syncAhead(supabase);
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
  // Taking the current plan away leaves the one behind it as the current plan.
  else await supabase.from("meal_plans").update({ ahead: false }).eq("ahead", true).is("closed_at", null);
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

// The plan ahead's start follows the current plan's last meal (REQ-162).
async function syncAhead(supabase: Awaited<ReturnType<typeof createClient>>) {
  try {
    await syncAheadStart(supabase);
  } catch (error) {
    Sentry.captureException(error);
  }
}

async function readEntries(supabase: Awaited<ReturnType<typeof createClient>>, planId: string) {
  const { data } = await supabase.from("meal_plan_recipes").select(ENTRY_COLUMNS).eq("plan_id", planId).order("position");
  return ((data ?? []) as PlannedRecipe[]).filter((entry) => entry.id);
}

// A plan's start day, for working out where an entry lands.
async function startOf(supabase: Awaited<ReturnType<typeof createClient>>, planId: string): Promise<string | null> {
  const { data } = await supabase.from("meal_plans").select("starts_on").eq("id", planId).maybeSingle();
  return (data as { starts_on: string } | null)?.starts_on ?? null;
}

function slotFrom(value: unknown): number | null {
  const text = String(value ?? "").trim();
  return /^\d{1,3}$/.test(text) ? Number(text) : null;
}

// Put the entries in this order (one step on the database).
async function setOrder(supabase: Awaited<ReturnType<typeof createClient>>, planId: string, ids: string[]) {
  const { error } = await supabase.rpc("set_plan_order", { p_plan: planId, p_order: ids });
  if (error) throw new Error(error.message);
}

// Adding a recipe is what counts it as planned (REQ-115): its times
// planned and date last planned are read from these rows. REQ-164: it goes
// to the next free meal unless a meal is chosen; "Eating out" is an entry
// that takes one dinner and has no recipe.
export async function addToPlan(_prev: PlanFormState, formData: FormData): Promise<PlanFormState> {
  const supabase = await requireMember();
  const planId = idFrom(formData.get("plan_id"));
  const eatingOut = formData.get("intent") === "eating_out";
  const recipeId = eatingOut ? null : idFrom(formData.get("recipe_id"));
  const servings = eatingOut ? 2 : Number(formData.get("servings") ?? 4);
  const slot = slotFrom(formData.get("slot"));
  if (!planId) return { error: "Start a plan first." };
  if (!eatingOut && !recipeId) return { error: "Choose a recipe to add." };
  if (!isPlanServings(servings)) return { error: "A recipe is 4 servings or 2." };
  try {
    const entries = await readEntries(supabase, planId);
    const entry = {
      id: crypto.randomUUID(),
      plan_id: planId,
      recipe_id: recipeId,
      eating_out: eatingOut,
      servings,
      position: entries.reduce((most, item) => Math.max(most, item.position), 0) + 1,
    };
    const { error } = await supabase.from("meal_plan_recipes").insert(entry);
    if (error?.code === "23505") return { error: "That recipe is already in the plan." };
    if (error) throw new Error(error.message);
    const startsOn = slot === null ? null : await startOf(supabase, planId);
    if (slot !== null && startsOn) {
      const added = { ...entry, cooked: false, carry_over: false, added_at: "" };
      await setOrder(supabase, planId, orderedFor(startsOn, entries, added, slot).map((item) => item.id));
    }
  } catch (error) {
    Sentry.captureException(error);
    return { error: "It couldn't be added. Try again." };
  }
  await syncAhead(supabase);
  refresh();
  return {};
}

function entryFrom(formData: FormData) {
  const planId = idFrom(formData.get("plan_id"));
  const entryId = idFrom(formData.get("entry_id"));
  return planId && entryId ? { planId, entryId } : null;
}

async function changePlanned(formData: FormData, change: { servings?: number; cooked?: boolean; carry_over?: boolean } | "remove") {
  const supabase = await requireMember();
  const row = entryFrom(formData);
  if (!row) return;
  const table = supabase.from("meal_plan_recipes");
  const query = change === "remove" ? table.delete() : table.update(change);
  const { error } = await query.eq("plan_id", row.planId).eq("id", row.entryId);
  if (error) Sentry.captureException(new Error(error.message));
  await syncAhead(supabase);
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

// REQ-164: "Move to..." a chosen meal, or one place up or down. The others
// shift to fill, and the plan's end (and the plan ahead's start) follow.
export async function moveEntry(formData: FormData): Promise<void> {
  const supabase = await requireMember();
  const row = entryFrom(formData);
  if (!row) return;
  try {
    const entries = await readEntries(supabase, row.planId);
    const index = entries.findIndex((entry) => entry.id === row.entryId);
    if (index === -1) return;
    const slot = slotFrom(formData.get("slot"));
    const step = formData.get("step") === "up" ? -1 : formData.get("step") === "down" ? 1 : 0;
    let order: PlannedRecipe[];
    if (slot !== null) {
      const startsOn = await startOf(supabase, row.planId);
      if (!startsOn) return;
      order = orderedFor(startsOn, entries.filter((entry) => entry.id !== row.entryId), entries[index], slot);
    } else if (step !== 0 && entries[index + step]) {
      order = [...entries];
      [order[index], order[index + step]] = [order[index + step], order[index]];
    } else {
      return;
    }
    await setOrder(supabase, row.planId, order.map((entry) => entry.id));
  } catch (error) {
    Sentry.captureException(error);
    return;
  }
  await syncAhead(supabase);
  refresh();
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
