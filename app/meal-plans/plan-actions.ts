"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission } from "../../lib/auth/permissions";
import { householdToday } from "../../lib/finances/budget-year";
import {
  blockerAt,
  cantStartBecause,
  daysBetween,
  isWeekendDay,
  mealName,
  mealPlace,
  nextFreeMeal,
  parseMealKey,
  pushBack,
  slide,
  startOf,
  swapWithNeighbour,
  type Meal,
  type MealKind,
  type Sited,
} from "../../lib/meal-plans/meals";
import { ENTRY_COLUMNS, isPlanSize, nextPlanStart, readStoredPlans, saveLayout, syncAheadStart, type MealPlan, type PlannedRecipe } from "../../lib/meal-plans/plan";
import { readRecipe } from "../../lib/meal-plans/recipes";
import { isFactor, scaleRecipe } from "../../lib/meal-plans/scale";
import { createClient } from "../../lib/supabase/server";

// Meal Plan batch 2: saving a scaled card (REQ-113), hiding a recipe
// (REQ-114), and the week's plan (REQ-115). Batch 3: closing a week,
// carrying a recipe over and rating (REQ-116).

export type PlanFormState = { error?: string; notice?: string };

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

type Supabase = Awaited<ReturnType<typeof createClient>>;

// REQ-115: either of us starts a plan on any day. REQ-162: with one open,
// the new plan goes behind it and starts at the first dinner after its last meal, so
// the day asked for is ignored; it never closes anything. REQ-168: a plan
// starts at dinner, or at lunch on a weekend day when we choose it.
export async function startPlan(_prev: PlanFormState, formData: FormData): Promise<PlanFormState> {
  const supabase = await requireMember();
  const { current, ahead } = await readStoredPlans(supabase);
  if (ahead) return { error: "There's already a plan ahead." };
  const startsOn = current ? nextPlanStart(current) : dayFrom(formData.get("starts_on"));
  if (!startsOn) return { error: "Choose the day the plan starts." };
  const startsMeal: MealKind = !current && formData.get("starts_meal") === "lunch" ? "lunch" : "dinner";
  if (startsMeal === "lunch" && !isWeekendDay(startsOn, new Set())) return { error: "A plan starts at lunch only on a Saturday or Sunday." };
  const { error } = await supabase.rpc("start_meal_plan", { p_starts_on: startsOn, p_starts_meal: startsMeal });
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

// A plan as the rules see it: its start, its entries and its days off.
async function loadPlan(supabase: Supabase, planId: string): Promise<MealPlan | null> {
  const { data } = await supabase.from("meal_plans").select("id, starts_on, starts_meal, ahead").eq("id", planId).is("closed_at", null).maybeSingle();
  const plan = data as { id: string; starts_on: string; starts_meal: MealKind; ahead: boolean | null } | null;
  if (!plan) return null;
  const [entries, off] = await Promise.all([
    supabase.from("meal_plan_recipes").select(ENTRY_COLUMNS).eq("plan_id", planId),
    supabase.from("meal_plan_days_off").select("day").eq("plan_id", planId),
  ]);
  const recipes = ((entries.data ?? []) as PlannedRecipe[]).filter((entry) => entry.id && entry.meal_on && entry.meal && entry.meals).sort((a, b) => startOf(a) - startOf(b));
  return {
    id: plan.id,
    starts_on: plan.starts_on,
    starts_meal: plan.starts_meal ?? "dinner",
    ahead: plan.ahead === true,
    recipes,
    daysOff: new Set(((off.data ?? []) as { day: string }[]).map((row) => row.day)),
  };
}

// Days before today are locked in a plan that has started: nothing is
// added to, moved to or moved from them. A plan ahead hasn't started, so
// it never locks. No cut-off times within a day (REQ-168).
function lockedBefore(plan: MealPlan): string | null {
  return plan.ahead ? null : householdToday();
}

const PASSED = "That day has passed.";

// REQ-169: Eating out on a dinner a dish is on pushes that dish and every
// later dish back a day, in one step on the database. A dish that no longer
// fits the week leaves the plan; the answer says which, in words.
async function pushForEatingOut(supabase: Supabase, plan: MealPlan, eatingOut: PlannedRecipe, at: Meal, isNew: boolean): Promise<string | undefined> {
  const pushed = pushBack(plan, plan.recipes, eatingOut, at, plan.daysOff);
  if (!pushed) return undefined;
  const layout = pushed.entries.filter((entry) => !(isNew && entry.id === eatingOut.id)).map((entry) => ({ id: entry.id, meal_on: entry.meal_on, meal: entry.meal, meals: entry.meals }));
  const { error } = await supabase.rpc("push_plan_back", {
    p_plan: plan.id,
    p_layout: layout,
    p_drop: pushed.dropped.map((entry) => entry.id),
    p_eating_out: isNew ? { id: eatingOut.id, meal_on: at.day } : null,
  });
  if (error) throw new Error(error.message);
  if (pushed.dropped.length === 0) return undefined;
  const names = await Promise.all(pushed.dropped.map((entry) => entryName(supabase, entry)));
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  return `${list} didn't fit this week and ${names.length > 1 ? "were" : "was"} taken off the plan. ${names.length > 1 ? "They'll" : "It'll"} be suggested first next week.`;
}

async function entryName(supabase: Supabase, entry: Pick<PlannedRecipe, "eating_out" | "recipe_id">): Promise<string> {
  if (entry.eating_out || !entry.recipe_id) return "Eating out";
  const { data } = await supabase.from("recipes").select("name").eq("id", entry.recipe_id).maybeSingle();
  return (data as { name: string } | null)?.name ?? "A recipe";
}

// "Dinner Tue is taken by Chilli chicken."
async function takenMessage(supabase: Supabase, taken: { meal: Meal; by: PlannedRecipe }): Promise<string> {
  return `${mealName(taken.meal)} is taken by ${await entryName(supabase, taken.by)}.`;
}

export async function changePlanStart(_prev: PlanFormState, formData: FormData): Promise<PlanFormState> {
  const supabase = await requireMember();
  const id = idFrom(formData.get("plan_id"));
  const startsOn = dayFrom(formData.get("starts_on"));
  if (!id) return { error: "That plan is gone." };
  if (!startsOn) return { error: "Choose the day the plan starts." };
  try {
    const plan = await loadPlan(supabase, id);
    if (!plan) return { error: "That plan is gone." };
    // The dishes go with the start: every dish moves by the same days, then settles.
    // A lunch start belongs to a weekend day or a Day off; on any other day the plan starts at dinner.
    const startsMeal: MealKind = plan.starts_meal === "lunch" && isWeekendDay(startsOn, plan.daysOff) ? "lunch" : "dinner";
    await saveLayout(supabase, id, startsOn, startsMeal, slide(plan.recipes, daysBetween(plan.starts_on, startsOn), plan.daysOff));
  } catch (error) {
    Sentry.captureException(error);
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
async function syncAhead(supabase: Supabase) {
  try {
    await syncAheadStart(supabase);
  } catch (error) {
    Sentry.captureException(error);
  }
}

// Adding a recipe is what counts it as planned (REQ-115): its times
// planned and date last planned are read from these rows. REQ-168: it goes
// to the next free meal it can start at unless a meal is chosen; "Eating
// out" is an entry that takes one dinner and has no recipe.
export async function addToPlan(_prev: PlanFormState, formData: FormData): Promise<PlanFormState> {
  const supabase = await requireMember();
  const planId = idFrom(formData.get("plan_id"));
  const eatingOut = formData.get("intent") === "eating_out";
  const recipeId = eatingOut ? null : idFrom(formData.get("recipe_id"));
  const size = eatingOut ? 1 : Number(formData.get("meals") ?? 2);
  const chosen = String(formData.get("meal") ?? "").trim();
  let notice: string | undefined;
  if (!planId) return { error: "Start a plan first." };
  if (!eatingOut && !recipeId) return { error: "Choose a recipe to add." };
  if (!isPlanSize(size)) return { error: "A dish is 2 meals or 1 meal." };
  if (chosen && !parseMealKey(chosen)) return { error: "Choose a meal from the list." };
  try {
    const plan = await loadPlan(supabase, planId);
    if (!plan) return { error: "That plan is gone." };
    const entry = { id: crypto.randomUUID(), eating_out: eatingOut, meals: size };
    const locked = lockedBefore(plan);
    const at = chosen ? parseMealKey(chosen) : nextFreeMeal(plan, plan.recipes, entry, plan.daysOff, locked);
    if (!at) return { error: "The plan is full for the week." };
    const cant = cantStartBecause(entry, at, plan.daysOff);
    if (cant) return { error: cant };
    if (locked && at.day < locked) return { error: PASSED };
    const taken = blockerAt(plan.recipes, entry, at);
    if (taken && eatingOut && !taken.by.eating_out) {
      // Eating out on a dinner that has a dish pushes the dish back (REQ-169).
      const added: PlannedRecipe = { ...entry, recipe_id: null, meal_on: at.day, meal: "dinner", meals: 1, cooked: false, carry_over: false, added_at: new Date().toISOString() };
      notice = await pushForEatingOut(supabase, plan, added, at, true);
    } else if (taken) {
      return { error: await takenMessage(supabase, taken) };
    } else {
      const { error } = await supabase.from("meal_plan_recipes").insert({ ...entry, plan_id: planId, recipe_id: recipeId, meal_on: at.day, meal: at.meal });
      if (error?.code === "23505") return { error: "That recipe is already in the plan." };
      if (error) throw new Error(error.message);
      // Planned again: no longer waiting to be proposed.
      if (recipeId) await supabase.from("meal_plan_proposed_next").delete().eq("recipe_id", recipeId);
    }
  } catch (error) {
    Sentry.captureException(error);
    return { error: "It couldn't be added. Try again." };
  }
  await syncAhead(supabase);
  refresh();
  return notice ? { notice } : {};
}

function entryFrom(formData: FormData) {
  const planId = idFrom(formData.get("plan_id"));
  const entryId = idFrom(formData.get("entry_id"));
  return planId && entryId ? { planId, entryId } : null;
}

async function changePlanned(formData: FormData, change: { cooked?: boolean; carry_over?: boolean } | "remove") {
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

// REQ-168: a dish is 2 meals or 1. From 2 to 1 frees its second meal; from
// 1 to 2 the next meal has to be free, and the app says what is in the way.
export async function setPlanMeals(_prev: PlanFormState, formData: FormData): Promise<PlanFormState> {
  const supabase = await requireMember();
  const row = entryFrom(formData);
  const size = Number(formData.get("meals"));
  if (!row) return { error: "That dish is gone." };
  if (!isPlanSize(size)) return { error: "A dish is 2 meals or 1 meal." };
  try {
    const plan = await loadPlan(supabase, row.planId);
    const entry = plan?.recipes.find((item) => item.id === row.entryId);
    if (!plan || !entry) return { error: "That dish is gone." };
    if (entry.eating_out || entry.meals === size) return {};
    const locked = lockedBefore(plan);
    if (locked && entry.meal_on < locked) return { error: PASSED };
    if (size === 2) {
      const grown = { ...entry, meals: size };
      const at = { day: entry.meal_on, meal: entry.meal };
      const cant = cantStartBecause(grown, at, plan.daysOff);
      if (cant) return { error: cant };
      const taken = blockerAt(plan.recipes, grown, at);
      if (taken) return { error: await takenMessage(supabase, taken) };
    }
    const { error } = await supabase.from("meal_plan_recipes").update({ meals: size }).eq("plan_id", row.planId).eq("id", row.entryId);
    if (error) throw new Error(error.message);
  } catch (error) {
    Sentry.captureException(error);
    return { error: "The size couldn't be changed. Try again." };
  }
  await syncAhead(supabase);
  refresh();
  return {};
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

// REQ-168: "Move to..." a chosen meal, or one place up or down. A dish
// can't be moved onto a taken meal (the app says which dish is there); the
// arrows swap places with the next dish, and whatever no longer fits
// settles by the reflow rule. The plan's end, and the plan ahead's start,
// follow.
export async function moveEntry(_prev: PlanFormState, formData: FormData): Promise<PlanFormState> {
  const supabase = await requireMember();
  const row = entryFrom(formData);
  if (!row) return { error: "That dish is gone." };
  const target = String(formData.get("meal") ?? "").trim();
  const step = formData.get("step") === "up" ? -1 : formData.get("step") === "down" ? 1 : 0;
  let notice: string | undefined;
  try {
    const plan = await loadPlan(supabase, row.planId);
    const entry = plan?.recipes.find((item) => item.id === row.entryId);
    if (!plan || !entry) return { error: "That dish is gone." };
    const locked = lockedBefore(plan);
    const passed = (day: string) => locked !== null && day < locked;
    let moved: Sited[] | null;
    if (target) {
      const at = parseMealKey(target);
      if (!at) return { error: "Choose a meal from the list." };
      if (passed(entry.meal_on) || passed(at.day)) return { error: PASSED };
      const cant = cantStartBecause(entry, at, plan.daysOff);
      if (cant) return { error: cant };
      const taken = blockerAt(plan.recipes, entry, at);
      if (taken && entry.eating_out && !taken.by.eating_out) {
        // An Eating out moved onto a dinner that has a dish pushes the dish back (REQ-169).
        notice = await pushForEatingOut(supabase, plan, entry, at, false);
        moved = null;
      } else if (taken) {
        return { error: await takenMessage(supabase, taken) };
      } else {
        moved = plan.recipes.map((item) => (item.id === entry.id ? { ...item, meal_on: at.day, meal: at.meal } : item));
      }
    } else if (step !== 0) {
      const swapped = swapWithNeighbour(plan.recipes, entry.id, step, plan.daysOff);
      if (!swapped) return {};
      const before = new Map(plan.recipes.map((item) => [item.id, startOf(item)]));
      const changed = swapped.filter((item) => before.get(item.id) !== startOf(item));
      if (changed.some((item) => passed(item.meal_on)) || changed.some((item) => passed(plan.recipes.find((old) => old.id === item.id)?.meal_on ?? item.meal_on))) {
        return { error: PASSED };
      }
      moved = swapped;
    } else {
      return {};
    }
    if (moved) await saveLayout(supabase, plan.id, plan.starts_on, plan.starts_meal, moved);
  } catch (error) {
    Sentry.captureException(error);
    return { error: "It couldn't be moved. Try again." };
  }
  await syncAhead(supabase);
  refresh();
  return notice ? { notice } : {};
}

// REQ-168: a Day off turns a weekday into a weekend day for this plan, so
// a 2-meal dish may start at its lunch. Marked by hand either of us.
export async function markDayOff(_prev: PlanFormState, formData: FormData): Promise<PlanFormState> {
  const supabase = await requireMember();
  const planId = idFrom(formData.get("plan_id"));
  const day = dayFrom(formData.get("day"));
  if (!planId) return { error: "That plan is gone." };
  if (!day) return { error: "Choose the day." };
  const { error } = await supabase.from("meal_plan_days_off").upsert({ plan_id: planId, day }, { onConflict: "plan_id,day" });
  if (error) {
    Sentry.captureException(new Error(error.message));
    return { error: "The day couldn't be marked. Try again." };
  }
  refresh();
  return {};
}

// Taking a Day off back can't strand a 2-meal dish that starts at that
// day's lunch; the app says which one, and it can be moved first.
export async function unmarkDayOff(_prev: PlanFormState, formData: FormData): Promise<PlanFormState> {
  const supabase = await requireMember();
  const planId = idFrom(formData.get("plan_id"));
  const day = dayFrom(formData.get("day"));
  if (!planId || !day) return { error: "That day is gone." };
  try {
    const plan = await loadPlan(supabase, planId);
    if (!plan) return { error: "That plan is gone." };
    const without = new Set([...plan.daysOff].filter((off) => off !== day));
    const stranded = plan.recipes.find((entry) => !entry.eating_out && entry.meals === 2 && entry.meal === "lunch" && entry.meal_on === day && !isWeekendDay(day, without));
    if (stranded) return { error: `${await entryName(supabase, stranded)} starts at lunch that day. Move it first.` };
    const { error } = await supabase.from("meal_plan_days_off").delete().eq("plan_id", planId).eq("day", day);
    if (error) throw new Error(error.message);
  } catch (error) {
    Sentry.captureException(error);
    return { error: "The day couldn't be unmarked. Try again." };
  }
  refresh();
  return {};
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
