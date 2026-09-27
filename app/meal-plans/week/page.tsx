import Link from "next/link";
import { householdToday } from "../../../lib/finances/budget-year";
import { coversThrough, dayLabel, readOpenPlan } from "../../../lib/meal-plans/plan";
import { readRecipes } from "../../../lib/meal-plans/recipes";
import { MealPlansScreen, mealPlansViewer } from "../frame";
import { AddToPlanForm, ChangeStartForm, PlannedControls, StartPlanForm } from "../plan-forms";
import { removePlan, takeOffPlan } from "../plan-actions";
import styles from "../meal-plans.module.css";

// REQ-115: this week's plan, the same one for both of us. Recipes have no
// day of their own; the plan says how far they carry us.
export default async function WeekPage() {
  const viewer = await mealPlansViewer();
  const [plan, recipes] = await Promise.all([readOpenPlan(viewer.supabase), readRecipes(viewer.supabase)]);
  if (!plan) {
    return (
      <MealPlansScreen viewer={viewer} section="This week">
        <section className={styles.formCard} aria-label="This week">
          <h2 className={styles.title}>No plan yet</h2>
          <StartPlanForm today={householdToday()} />
        </section>
      </MealPlansScreen>
    );
  }
  const names = new Map(recipes.map((recipe) => [recipe.id, recipe.name]));
  const planned = plan.recipes.filter((entry) => names.has(entry.recipe_id));
  const through = coversThrough(plan.starts_on, planned);
  const inPlan = new Set(planned.map((entry) => entry.recipe_id));
  const addable = recipes.filter((recipe) => !recipe.hidden && !inPlan.has(recipe.id));
  return (
    <MealPlansScreen viewer={viewer} section="This week">
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
                  <PlannedControls planId={plan.id} recipeId={entry.recipe_id} name={name} servings={entry.servings} cooked={entry.cooked} />
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
            No recipes yet. <Link href="/meal-plans/new">Add one</Link> first.
          </p>
        ) : (
          <AddToPlanForm planId={plan.id} recipes={addable} />
        )}
        <ChangeStartForm planId={plan.id} startsOn={plan.starts_on} />
        <form action={removePlan}>
          <input type="hidden" name="plan_id" value={plan.id} />
          <button type="submit" className={styles.linkButton}>
            Remove this plan
          </button>
        </form>
      </section>
    </MealPlansScreen>
  );
}
