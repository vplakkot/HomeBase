import Link from "next/link";
import { householdToday } from "../../../lib/finances/budget-year";
import {
  carriedOver,
  coversText,
  dayLabel,
  entryMeals,
  layoutPlan,
  mealChoices,
  mealName,
  planStats,
  readLastClosedPlan,
  readPlans,
  readPlanRows,
  type MealPlan,
} from "../../../lib/meal-plans/plan";
import { averageRatings, readRatingPrompts, readRatings } from "../../../lib/meal-plans/ratings";
import { readRecipes, type Recipe } from "../../../lib/meal-plans/recipes";
import { suggestions } from "../../../lib/meal-plans/suggest";
import { MealPlansScreen, mealPlansViewer } from "../frame";
import { AddToPlanForm, AddToWeekButton, ChangeStartForm, MoveControls, PlanAheadForm, PlannedControls, StartPlanForm } from "../plan-forms";
import { closePlan, removePlan, reopenPlan, takeOffPlan } from "../plan-actions";
import { RatePrompts } from "../rate-prompts";
import styles from "../meal-plans.module.css";

const UUID = /^[0-9a-f-]{36}$/i;

// One plan, laid out by meal (REQ-164): a card per entry in meal order,
// each with the meals it covers, and "Not planned" where a lunch is left
// free. `ahead` is the plan queued behind the current one (REQ-162): its
// start isn't ours to change, it follows the current plan's last meal.
function PlanCard({ plan, recipes, names, ahead }: { plan: MealPlan; recipes: readonly Recipe[]; names: Map<string, string>; ahead: boolean }) {
  const entries = plan.recipes.filter((entry) => entry.eating_out || (entry.recipe_id && names.has(entry.recipe_id)));
  const layout = layoutPlan(plan.starts_on, entries);
  const meals = mealChoices(plan.starts_on, entries);
  const inPlan = new Set(entries.flatMap((entry) => (entry.recipe_id ? [entry.recipe_id] : [])));
  const addable = recipes.filter((recipe) => !recipe.hidden && !inPlan.has(recipe.id));
  return (
    <section className={styles.formCard} aria-label={ahead ? "Next plan" : "This week"}>
      <div className={styles.fileHead}>
        <h2 className={styles.title}>{ahead ? `Next plan, from ${dayLabel(plan.starts_on)}` : `From ${dayLabel(plan.starts_on)}`}</h2>
      </div>
      <p className={styles.covers}>{coversText(layout.end, entries.length > 0)}</p>
      {layout.rows.length > 0 ? (
        <ul className={styles.planList} aria-label={ahead ? "Entries in the next plan" : "Recipes in the plan"}>
          {layout.rows.map((row) => {
            if (row.kind === "gap") {
              return (
                <li key={`gap-${row.slot}`} className={styles.planGap}>
                  {mealName(row.meal)} · Not planned
                </li>
              );
            }
            const { entry } = row;
            const name = entry.eating_out ? "Eating out" : (names.get(entry.recipe_id ?? "") ?? "");
            const position = entries.indexOf(entry);
            return (
              <li key={entry.id} className={styles.planRow}>
                <span className={styles.planMeals}>{entryMeals(row.meals)}</span>
                {entry.eating_out ? (
                  <span>{name}</span>
                ) : (
                  <Link href={`/meal-plans/${entry.recipe_id}`} className={entry.cooked ? styles.cooked : undefined}>
                    {name}
                  </Link>
                )}
                {entry.eating_out ? null : (
                  <PlannedControls
                    planId={plan.id}
                    entryId={entry.id}
                    name={name}
                    servings={entry.servings}
                    cooked={entry.cooked}
                    carryOver={entry.carry_over}
                  />
                )}
                <MoveControls planId={plan.id} entryId={entry.id} name={name} meals={meals} first={position === 0} last={position === entries.length - 1} />
                <form action={takeOffPlan}>
                  <input type="hidden" name="plan_id" value={plan.id} />
                  <input type="hidden" name="entry_id" value={entry.id} />
                  <button type="submit" className={styles.linkButton} aria-label={`Take ${name} off the plan`}>
                    Remove
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      ) : null}
      {recipes.length === 0 ? (
        <p className={styles.empty}>
          No recipes yet.{" "}
          <Link href="/meal-plans/new" className={styles.textLink}>
            Add one
          </Link>{" "}
          first.
        </p>
      ) : null}
      <AddToPlanForm planId={plan.id} recipes={addable} meals={meals} />
      {ahead ? null : (
        <>
          <details className={styles.startDay}>
            <summary className={styles.linkButton}>Change the start day</summary>
            <ChangeStartForm planId={plan.id} startsOn={plan.starts_on} />
          </details>
          <form action={closePlan}>
            <input type="hidden" name="plan_id" value={plan.id} />
            <button type="submit" className={styles.linkButton}>
              Close this plan
            </button>
          </form>
        </>
      )}
      <form action={removePlan}>
        <input type="hidden" name="plan_id" value={plan.id} />
        <button type="submit" className={styles.linkButton}>
          Remove this plan
        </button>
      </form>
    </section>
  );
}

// REQ-115: the plans, the same ones for both of us. REQ-164: laid out by
// meal. REQ-162: one more can be planned ahead while this one runs.
// REQ-116: closing it, and rating what we cooked. REQ-117: suggestions
// while we plan; "Not now" drops one for this visit (it's kept in the
// address).
export default async function WeekPage({ searchParams }: { searchParams?: Promise<{ skip?: string }> } = {}) {
  const viewer = await mealPlansViewer();
  const query = (await searchParams) ?? {};
  const [{ current: plan, ahead }, lastClosed, recipes, rows, ratings, prompts] = await Promise.all([
    readPlans(viewer.supabase),
    readLastClosedPlan(viewer.supabase),
    readRecipes(viewer.supabase),
    readPlanRows(viewer.supabase),
    readRatings(viewer.supabase),
    readRatingPrompts(viewer.supabase, viewer.userId),
  ]);
  const names = new Map(recipes.map((recipe) => [recipe.id, recipe.name]));
  const toRate = prompts.flatMap((id) => (names.has(id) ? [{ id, name: names.get(id) ?? "" }] : []));
  const today = householdToday();
  if (!plan) {
    return (
      <MealPlansScreen viewer={viewer} section="This week">
        <RatePrompts recipes={toRate} />
        <section className={styles.formCard} aria-label="This week">
          <h2 className={styles.title}>No plan yet</h2>
          <StartPlanForm today={today} label="New meal plan" />
          {lastClosed ? (
            <form action={reopenPlan}>
              <input type="hidden" name="plan_id" value={lastClosed} />
              <button type="submit" className={styles.linkButton}>
                Reopen the last plan
              </button>
            </form>
          ) : null}
        </section>
      </MealPlansScreen>
    );
  }
  const inPlan = new Set([...plan.recipes, ...(ahead?.recipes ?? [])].flatMap((entry) => (entry.recipe_id ? [entry.recipe_id] : [])));
  const skipped = (query.skip ?? "").split(",").filter((id) => UUID.test(id));
  const suggested = suggestions({
    recipes,
    stats: planStats(rows),
    averages: averageRatings(ratings),
    carried: carriedOver(rows, lastClosed),
    inPlan,
    dismissed: new Set(skipped),
    today,
  });
  return (
    <MealPlansScreen viewer={viewer} section="This week">
      <RatePrompts recipes={toRate} />
      <PlanCard plan={plan} recipes={recipes} names={names} ahead={false} />
      {suggested.length > 0 ? (
        <section className={styles.section} aria-label="Suggestions">
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Suggestions</h2>
          </div>
          <ul className={styles.planList}>
            {suggested.map(({ recipe, label }) => (
              <li key={recipe.id} className={styles.planRow}>
                <Link href={`/meal-plans/${recipe.id}`}>{recipe.name}</Link>
                {label ? <span className={styles.tag}>{label}</span> : null}
                <AddToWeekButton planId={plan.id} recipeId={recipe.id} label="Add" />
                <Link href={`/meal-plans/week?skip=${[...skipped, recipe.id].join(",")}`} className={styles.linkButton} aria-label={`Not now: ${recipe.name}`}>
                  Not now
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {ahead ? (
        <PlanCard plan={ahead} recipes={recipes} names={names} ahead />
      ) : (
        <section className={styles.formCard} aria-label="Next plan">
          <PlanAheadForm />
        </section>
      )}
    </MealPlansScreen>
  );
}
