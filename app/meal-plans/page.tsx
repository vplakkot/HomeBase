import { OVERVIEW } from "../../components/module-frame";
import Link from "next/link";
import { readPeople } from "../../lib/drinks/drinks";
import { signedPhotoLinks } from "../../lib/drinks/photos";
import { householdToday } from "../../lib/finances/budget-year";
import { homeStats } from "../../lib/meal-plans/home";
import { RECIPE_PHOTOS } from "../../lib/meal-plans/photos";
import { coversText, coversThrough, planStats, readOpenPlan, readPlanRows } from "../../lib/meal-plans/plan";
import { averageRatings, readRatingPrompts, readRatings, starsText } from "../../lib/meal-plans/ratings";
import { readImports, readRecipes } from "../../lib/meal-plans/recipes";
import { dismissImport } from "./actions";
import { MealPlansScreen, mealPlansViewer } from "./frame";
import { StartPlanForm } from "./plan-forms";
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
// dishes as big photos, how long they last, and a few fun numbers. Above
// them, anything to rate (REQ-116) and recipes on their way in.
export default async function MealPlansPage() {
  const viewer = await mealPlansViewer();
  const [all, imports, plan, prompts, rows, ratings, people] = await Promise.all([
    readRecipes(viewer.supabase),
    readImports(viewer.supabase),
    readOpenPlan(viewer.supabase),
    readRatingPrompts(viewer.supabase, viewer.userId),
    readPlanRows(viewer.supabase),
    readRatings(viewer.supabase),
    readPeople(viewer.supabase),
  ]);
  const byId = new Map(all.map((recipe) => [recipe.id, recipe]));
  const planned = plan?.recipes.flatMap((entry) => byId.get(entry.recipe_id) ?? []) ?? [];
  const through = plan ? coversThrough(plan.starts_on, plan.recipes.filter((entry) => byId.has(entry.recipe_id)), people.length) : null;
  const photos = await signedPhotoLinks(
    viewer.supabase,
    planned.flatMap((recipe) => (recipe.photo ? [recipe.photo] : [])),
    60 * 60,
    RECIPE_PHOTOS,
  );
  const numbers = homeStats(all, planStats(rows), averageRatings(ratings));
  return (
    <MealPlansScreen viewer={viewer} section={OVERVIEW}>
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
            <p className={styles.summary}>{through || planned.length > 0 ? coversText(through, planned.length > 0) : "An empty plate so far"}</p>
            {planned.length > 0 ? (
              <ul className={styles.foodGrid} aria-label="Recipes in the plan">
                {planned.map((recipe) => {
                  const photo = recipe.photo ? photos.get(recipe.photo) : undefined;
                  return (
                    <li key={recipe.id}>
                      <Link href={`/meal-plans/${recipe.id}`} className={styles.foodCard}>
                        {photo ? (
                          // eslint-disable-next-line @next/next/no-img-element -- a private, short-lived link
                          <img src={photo} alt="" className={styles.foodPhoto} />
                        ) : (
                          <span className={styles.foodPhoto} aria-hidden="true" />
                        )}
                        <span className={styles.cardTitle}>{recipe.name}</span>
                      </Link>
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
          <>
            <p className={styles.summary}>What are we eating this week?</p>
            <StartPlanForm today={householdToday()} thenWeek />
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
