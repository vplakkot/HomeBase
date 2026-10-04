import { OVERVIEW } from "../../components/module-frame";
import Link from "next/link";
import { ButtonLink } from "../../components/button";
import { householdToday } from "../../lib/finances/budget-year";
import { homeStats } from "../../lib/meal-plans/home";
import { coversText, entryMeals, layoutPlan, planStats, readPlans, readPlanRows } from "../../lib/meal-plans/plan";
import { averageRatings, readRatingPrompts, readRatings, starsText } from "../../lib/meal-plans/ratings";
import { readImports, readRecipes } from "../../lib/meal-plans/recipes";
import { dismissImport } from "./actions";
import { MealPlansScreen, mealPlansViewer } from "./frame";
import { PlanAheadForm, StartPlanForm } from "./plan-forms";
import { RatePrompts } from "./rate-prompts";
import styles from "./meal-plans.module.css";
import band from "../../components/band.module.css";

const STATUS: Record<string, string> = {
  uploading: "Sending the video",
  processing: "Gemini is reading it",
  ready: "Ready to review",
  failed: "Couldn't be read",
};

// REQ-118: Meal Plans' home is about food, not paperwork: this week's
// dishes, how long they last, and a few fun numbers. Above them, anything
// to rate (REQ-116) and recipes on their way in. REQ-155: the dishes are
// plain rows, a name and the meal it's for, with no photos. REQ-165: Add
// recipe and the plan action (New meal plan, or Plan ahead while one runs)
// sit side by side with equal weight; REQ-164: the meals come from the
// plan's layout.
export default async function MealPlansPage() {
  const viewer = await mealPlansViewer();
  const [all, imports, { current: plan, ahead }, prompts, rows, ratings] = await Promise.all([
    readRecipes(viewer.supabase),
    readImports(viewer.supabase),
    readPlans(viewer.supabase),
    readRatingPrompts(viewer.supabase, viewer.userId),
    readPlanRows(viewer.supabase),
    readRatings(viewer.supabase),
  ]);
  const byId = new Map(all.map((recipe) => [recipe.id, recipe]));
  const entries = plan?.recipes.filter((entry) => entry.eating_out || (entry.recipe_id && byId.has(entry.recipe_id))) ?? [];
  const layout = layoutPlan(plan?.starts_on ?? "", entries);
  const planned = layout.rows.flatMap((row) => (row.kind === "entry" ? [{ entry: row.entry, meals: row.meals }] : []));
  const numbers = homeStats(all, planStats(rows), averageRatings(ratings));
  return (
    <MealPlansScreen viewer={viewer} section={OVERVIEW}>
      <div className={styles.homeActions} role="group" aria-label="Start something">
        <ButtonLink href="/meal-plans/new">Add recipe</ButtonLink>
        {!plan ? <ButtonLink href="/meal-plans/week">New meal plan</ButtonLink> : !ahead ? <PlanAheadForm thenWeek /> : null}
      </div>
      <RatePrompts recipes={prompts.flatMap((id) => (byId.has(id) ? [{ id, name: byId.get(id)?.name ?? "" }] : []))} />
      {imports.length > 0 ? (
        <section className={styles.section} aria-label="On their way">
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>On their way</h2>
          </div>
          <ul className={styles.grid}>
            {imports.map((item) => (
              <li key={item.id} className={styles.card}>
                <Link href={`/meal-plans/drafts/${item.id}`} className={`${styles.cardTitle} ${band.band}`}>
                  {item.name}
                </Link>
                <span className={styles.cardDetail}>{STATUS[item.status]}</span>
                <form action={dismissImport}>
                  <input type="hidden" name="id" value={item.id} />
                  <input type="hidden" name="stay" value="yes" />
                  <button type="submit" className={styles.linkButton}>
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className={styles.section} aria-label="This week">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>On the menu</h2>
          {plan ? (
            <Link href="/meal-plans/week" className={styles.textLink}>
              Open the plan
            </Link>
          ) : null}
        </div>
        {plan ? (
          <>
            <p className={styles.summary}>{layout.end || planned.length > 0 ? coversText(layout.end, planned.length > 0) : "An empty plate so far"}</p>
            {planned.length > 0 ? (
              <ul className={styles.menu} aria-label="Recipes in the plan">
                {planned.map(({ entry, meals }) => (
                  <li key={entry.id}>
                    {entry.eating_out ? "Eating out" : <Link href={`/meal-plans/${entry.recipe_id}`}>{byId.get(entry.recipe_id ?? "")?.name}</Link>}
                    <span className={styles.menuMeal}>{entryMeals(meals)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Link href="/meal-plans/week" className={styles.textLink}>
                Add some recipes
              </Link>
            )}
          </>
        ) : (
          <>
            <p className={styles.summary}>What are we eating this week?</p>
            <StartPlanForm today={householdToday()} label="New meal plan" thenWeek />
          </>
        )}
      </section>
      <section className={styles.section} aria-label="Our kitchen">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Our kitchen</h2>
        </div>
        <dl className={styles.stats}>
          <div>
            <dt>Most planned</dt>
            <dd>
              {numbers.mostPlanned ? (
                <Link href={`/meal-plans/${numbers.mostPlanned.recipe.id}`}>
                  {numbers.mostPlanned.recipe.name} <span className={styles.statNote}>({numbers.mostPlanned.times})</span>
                </Link>
              ) : (
                "Nothing yet"
              )}
            </dd>
          </div>
          <div>
            <dt>Top rated</dt>
            <dd>
              {numbers.topRated ? (
                <Link href={`/meal-plans/${numbers.topRated.recipe.id}`}>
                  {numbers.topRated.recipe.name}{" "}
                  <span className={styles.stars} aria-label={`${numbers.topRated.average.toFixed(1)} of 5 stars`}>
                    {starsText(numbers.topRated.average)}
                  </span>
                </Link>
              ) : (
                "Nothing yet"
              )}
            </dd>
          </div>
          <div>
            <dt>Recipes</dt>
            <dd>
              <Link href="/meal-plans/recipes" className={styles.plain}>
                {numbers.recipes}
              </Link>
            </dd>
          </div>
          <div>
            <dt>Cuisines</dt>
            <dd>{numbers.cuisines}</dd>
          </div>
        </dl>
      </section>
    </MealPlansScreen>
  );
}
