import Link from "next/link";
import { householdToday } from "../../../lib/finances/budget-year";
import { carriedOver, coversThrough, dayLabel, planStats, readLastClosedPlan, readOpenPlan, readPlanRows } from "../../../lib/meal-plans/plan";
import { averageRatings, readRatingPrompts, readRatings } from "../../../lib/meal-plans/ratings";
import { readRecipes } from "../../../lib/meal-plans/recipes";
import { suggestions } from "../../../lib/meal-plans/suggest";
import { MealPlansScreen, mealPlansViewer } from "../frame";
import { AddToPlanForm, AddToWeekButton, ChangeStartForm, PlannedControls, StartPlanForm } from "../plan-forms";
import { closePlan, removePlan, reopenPlan, takeOffPlan } from "../plan-actions";
import { RatePrompts } from "../rate-prompts";
import styles from "../meal-plans.module.css";

const UUID = /^[0-9a-f-]{36}$/i;

// REQ-115: this week's plan, the same one for both of us. Recipes have no
// day of their own; the plan says how far they carry us. REQ-116: closing
// it, and rating what we cooked. REQ-117: suggestions while we plan;
// "Not now" drops one for this visit (it's kept in the address).
export default async function WeekPage({ searchParams }: { searchParams?: Promise<{ skip?: string }> } = {}) {
  const viewer = await mealPlansViewer();
  const query = (await searchParams) ?? {};
  const [plan, lastClosed, recipes, rows, ratings, prompts] = await Promise.all([
    readOpenPlan(viewer.supabase),
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
          <StartPlanForm today={today} />
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
  const planned = plan.recipes.filter((entry) => names.has(entry.recipe_id));
  const through = coversThrough(plan.starts_on, planned);
  const inPlan = new Set(planned.map((entry) => entry.recipe_id));
  const addable = recipes.filter((recipe) => !recipe.hidden && !inPlan.has(recipe.id));
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
      <section className={styles.formCard} aria-label="This week">
        <div className={styles.fileHead}>
          <h2 className={styles.title}>From {dayLabel(plan.starts_on)}</h2>
        </div>
        <p className={styles.covers}>
          {through
            ? `Covers you through at least ${dayLabel(through)}`
            : planned.length > 0
              ? "Covers half a day so far"
              : "Add recipes to see how long the plan lasts"}
        </p>
        {planned.length > 0 ? (
          <ul className={styles.planList} aria-label="Recipes in the plan">
            {planned.map((entry) => {
              const name = names.get(entry.recipe_id) ?? "";
              return (
                <li key={entry.recipe_id} className={styles.planRow}>
                  <Link href={`/meal-plans/${entry.recipe_id}`} className={entry.cooked ? styles.cooked : undefined}>
                    {name}
                  </Link>
                  <PlannedControls
                    planId={plan.id}
                    recipeId={entry.recipe_id}
                    name={name}
                    servings={entry.servings}
                    cooked={entry.cooked}
                    carryOver={entry.carry_over}
                  />
                  <form action={takeOffPlan}>
                    <input type="hidden" name="plan_id" value={plan.id} />
                    <input type="hidden" name="recipe_id" value={entry.recipe_id} />
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
        ) : (
          <AddToPlanForm planId={plan.id} recipes={addable} />
        )}
        <ChangeStartForm planId={plan.id} startsOn={plan.starts_on} />
        <form action={closePlan}>
          <input type="hidden" name="plan_id" value={plan.id} />
          <button type="submit" className={styles.linkButton}>
            Close this plan
          </button>
        </form>
        <form action={removePlan}>
          <input type="hidden" name="plan_id" value={plan.id} />
          <button type="submit" className={styles.linkButton}>
            Remove this plan
          </button>
        </form>
      </section>
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
      <section className={styles.formCard} aria-label="Next plan">
        <StartPlanForm today={today} label="Start the next plan" dateLabel="Next plan starts on" />
      </section>
    </MealPlansScreen>
  );
}
