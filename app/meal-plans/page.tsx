import { OVERVIEW } from "../../components/module-frame";
import Link from "next/link";
import { ButtonLink } from "../../components/button";
import { householdToday } from "../../lib/finances/budget-year";
import { homeStats, ratingText } from "../../lib/meal-plans/home";
import { signedPhotoLinks, thumbPath } from "../../lib/drinks/photos";
import { entryMeals, layoutPlan } from "../../lib/meal-plans/meals";
import { RECIPE_PHOTOS } from "../../lib/meal-plans/photos";
import { planStats, readPlans, readPlanRows, type MealPlan } from "../../lib/meal-plans/plan";
import { averageRatings, readRatingPrompts, readRatings } from "../../lib/meal-plans/ratings";
import { readImports, readRecipes, type Recipe } from "../../lib/meal-plans/recipes";
import { dismissImport } from "./actions";
import { MealPlansScreen, mealPlansViewer } from "./frame";
import { NewPlanForm, PlanAheadForm, RepeatRecipesSetting } from "./plan-forms";
import { PlanRange } from "./plan-range";
import { readSettings } from "../../lib/meal-plans/settings";
import { RatePrompts } from "./rate-prompts";
import styles from "./meal-plans.module.css";
import band from "../../components/band.module.css";

const STATUS: Record<string, string> = {
  uploading: "Sending the video",
  processing: "Gemini is reading it",
  ready: "Ready to review",
  failed: "Couldn't be read",
};

// REQ-173: the plan as one card, like a menu: its dates, then each dish with
// its photo and the meals it covers. The one for the plan we're on is "On
// the menu", the one queued behind it is "Next week". With no plan the card
// is still there, empty, with New meal plan.
function MenuCard({ label, plan, byId, thumbs, today }: { label: string; plan: MealPlan | null; byId: Map<string, Recipe>; thumbs: Map<string, string>; today: string }) {
  const entries = plan?.recipes.filter((entry) => entry.eating_out || (entry.recipe_id && byId.has(entry.recipe_id))) ?? [];
  const dishes = plan ? layoutPlan(plan, entries).rows.flatMap((row) => (row.kind === "entry" ? [{ entry: row.entry, meals: row.meals }] : [])) : [];
  return (
    <section className={styles.formCard} aria-label={label}>
      <div className={styles.fileHead}>
        <p className={styles.rangeMark}>{label}</p>
        {plan ? (
          <Link href="/meal-plans/week" className={styles.textLink}>
            Open the plan
          </Link>
        ) : null}
      </div>
      {plan ? (
        <>
          <h2 className={styles.title}>
            <PlanRange plan={plan} />
          </h2>
          {dishes.length > 0 ? (
            <ul className={styles.menu} aria-label={`${label}: dishes`}>
              {dishes.map(({ entry, meals }) => {
                const recipe = entry.recipe_id ? byId.get(entry.recipe_id) : undefined;
                const thumb = recipe?.photo ? thumbs.get(thumbPath(recipe.photo)) : undefined;
                return (
                  <li key={entry.id}>
                    {thumb ? <img src={thumb} alt="" className={styles.menuThumb} /> : null}
                    {entry.eating_out ? "Eating out" : <Link href={`/meal-plans/${entry.recipe_id}`}>{recipe?.name}</Link>}
                    <span className={styles.menuMeal}>{entryMeals(meals)}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Link href="/meal-plans/week" className={styles.textLink}>
              Add some recipes
            </Link>
          )}
        </>
      ) : (
        <NewPlanForm today={today} />
      )}
    </section>
  );
}

// REQ-118: Meal Plans' home is about food, not paperwork: this week's
// dishes, how long they last, and a few fun numbers. Above them, anything
// to rate (REQ-116) and recipes on their way in. REQ-155: the dishes are
// plain rows, a name and the meal it's for, with no photos. REQ-165: Add
// recipe and the plan action (New meal plan, or Plan next week while one runs)
// sit side by side with equal weight; REQ-164: the meals come from the
// plan's layout.
export default async function MealPlansPage() {
  const viewer = await mealPlansViewer();
  const [all, imports, { current: plan, ahead }, prompts, rows, ratings, settings] = await Promise.all([
    readRecipes(viewer.supabase),
    readImports(viewer.supabase),
    readPlans(viewer.supabase),
    readRatingPrompts(viewer.supabase, viewer.userId),
    readPlanRows(viewer.supabase),
    readRatings(viewer.supabase),
    readSettings(viewer.supabase),
  ]);
  const byId = new Map(all.map((recipe) => [recipe.id, recipe]));
  const numbers = homeStats(all, planStats(rows), averageRatings(ratings));
  // The photos of the dishes on the menu, as small signed thumbnails.
  const onMenu = [...(plan?.recipes ?? []), ...(ahead?.recipes ?? [])].flatMap((entry) => (entry.recipe_id ? [byId.get(entry.recipe_id)] : []));
  const thumbs = await signedPhotoLinks(
    viewer.supabase,
    onMenu.flatMap((recipe) => (recipe?.photo ? [thumbPath(recipe.photo)] : [])),
    60 * 60,
    RECIPE_PHOTOS,
  );
  return (
    <MealPlansScreen viewer={viewer} section={OVERVIEW}>
      <div className={styles.homeActions} role="group" aria-label="Start something">
        <ButtonLink href="/meal-plans/new">Add recipe</ButtonLink>
        {plan && !ahead ? <PlanAheadForm thenWeek /> : null}
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
      <MenuCard label="On the menu" plan={plan} byId={byId} thumbs={thumbs} today={householdToday()} />
      {ahead ? <MenuCard label="Next week" plan={ahead} byId={byId} thumbs={thumbs} today={householdToday()} /> : null}
      <section className={styles.section} aria-label="Our kitchen">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Our kitchen</h2>
        </div>
        <dl className={styles.stats}>
          <div>
            <dt>Most cooked</dt>
            <dd>
              {numbers.mostCooked ? (
                <Link href={`/meal-plans/${numbers.mostCooked.recipe.id}`}>
                  {numbers.mostCooked.recipe.name} <span className={styles.statNote}>({numbers.mostCooked.times})</span>
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
                    {ratingText(numbers.topRated.average)}
                  </span>
                </Link>
              ) : (
                "Nothing yet"
              )}
            </dd>
          </div>
          <div>
            <dt>Recipes</dt>
            <dd className={styles.statCentre}>
              <Link href="/meal-plans/recipes" className={styles.plain}>
                {numbers.recipes}
              </Link>
            </dd>
          </div>
          <div>
            <dt>Cuisines</dt>
            <dd className={styles.statCentre}>{numbers.cuisines}</dd>
          </div>
        </dl>
      </section>
      <section className={styles.section} aria-label="Settings">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Settings</h2>
        </div>
        <RepeatRecipesSetting on={settings.repeatRecipes} />
      </section>
    </MealPlansScreen>
  );
}
