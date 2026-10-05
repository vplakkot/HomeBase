import Link from "next/link";
import { notFound } from "next/navigation";
import { readPeople } from "../../../lib/drinks/drinks";
import { signedPhotoLinks } from "../../../lib/drinks/photos";
import { RECIPE_PHOTOS } from "../../../lib/meal-plans/photos";
import { dayLabel } from "../../../lib/meal-plans/meals";
import { readOpenPlan, readPlanStats } from "../../../lib/meal-plans/plan";
import { readRatings, starsText } from "../../../lib/meal-plans/ratings";
import { cookTimeText, readRecipe, recipeMissing } from "../../../lib/meal-plans/recipes";
import { mainMeatIndex } from "../../../lib/meal-plans/scale";
import { removeRecipe } from "../actions";
import { AddRecipe, AiGenerated } from "../forms";
import { MealPlansScreen, mealPlansViewer } from "../frame";
import { clearRecipeRating, setHidden } from "../plan-actions";
import { AddToWeekButton, RateRecipeForm } from "../plan-forms";
import { ScaledRecipe } from "../scale-box";
import styles from "../meal-plans.module.css";

const UUID = /^[0-9a-f-]{36}$/i;

// REQ-110: one recipe as one card: photo, links, the facts, ingredients
// with quantities, steps and notes, how often we've cooked it (REQ-175)
// and each person's rating, which its owner changes here (REQ-116).
export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const viewer = await mealPlansViewer();
  const [recipe, stats, plan, ratings, people] = await Promise.all([
    readRecipe(viewer.supabase, id),
    readPlanStats(viewer.supabase),
    readOpenPlan(viewer.supabase),
    readRatings(viewer.supabase),
    readPeople(viewer.supabase),
  ]);
  if (!recipe) notFound();
  const starsBy = new Map(ratings.filter((rating) => rating.recipe_id === recipe.id).map((rating) => [rating.user_id, rating.stars]));
  const mine = starsBy.get(viewer.userId) ?? null;
  const others = people.filter((person) => person.user_id !== viewer.userId);
  const cooked = stats.get(recipe.id) ?? { times: 0, last: null };
  const inPlan = plan?.recipes.some((entry) => entry.recipe_id === recipe.id) ?? false;
  const photo = recipe.photo ? (await signedPhotoLinks(viewer.supabase, [recipe.photo], 60 * 60, RECIPE_PHOTOS)).get(recipe.photo) : undefined;
  const facts = [
    ["Cuisine", recipe.cuisine],
    ["Main meat", recipe.main_meat],
    ["Cooking method", recipe.cooking_method],
    ["Cook time", cookTimeText(recipe.cook_minutes)],
    ["Servings", recipe.servings ? String(recipe.servings) : null],
    ["Times cooked", String(cooked.times)],
    ["Last cooked", cooked.last ? dayLabel(cooked.last) : "Never"],
  ] as const;
  return (
    <MealPlansScreen viewer={viewer} section="Recipes" crumb={recipe.name}>
      <article className={styles.formCard} aria-label={recipe.name}>
        <div className={styles.fileHead}>
          <h2 className={styles.title}>
            {recipe.name}
            {recipe.ai_generated ? <AiGenerated /> : null}
          </h2>
          <div className={styles.fileButtons}>
            {plan && !inPlan && !recipe.hidden ? <AddToWeekButton planId={plan.id} recipeId={recipe.id} /> : null}
            {inPlan ? <Link href="/meal-plans/week" className={styles.textLink}>
                In this week&apos;s plan
              </Link> : null}
            <Link href={`/meal-plans/${recipe.id}/edit`}>Edit</Link>
          </div>
        </div>
        {photo ? <img src={photo} alt={recipe.name} className={styles.hero} /> : null}
        {/* REQ-110, REQ-112: no recipe yet. Type it in, or have Gemini
            write a generic one to review. */}
        {recipeMissing(recipe) ? (
          <section className={styles.missing} aria-label="Recipe missing">
            <p>Recipe missing</p>
            <Link href={`/meal-plans/${recipe.id}/edit`}>Type it in</Link>
            <details className={styles.startDay}>
              <summary className={styles.linkButton}>Add details</summary>
              <AddRecipe fill={{ id: recipe.id, name: recipe.name }} />
            </details>
          </section>
        ) : null}
        {recipe.video_url || recipe.page_url ? (
          <p>
            {recipe.video_url ? (
              // REQ-112: on a phone, an Instagram or TikTok link opens in
              // its app when the app is installed; the phone decides that.
              <a href={recipe.video_url} target="_blank" rel="noreferrer">
                Watch the video
              </a>
            ) : null}
            {recipe.video_url && recipe.page_url ? " · " : null}
            {recipe.page_url ? (
              <a href={recipe.page_url} target="_blank" rel="noreferrer">
                Recipe page
              </a>
            ) : null}
          </p>
        ) : null}
        <dl className={styles.details}>
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value ?? "Not set"}</dd>
            </div>
          ))}
        </dl>
        <ScaledRecipe
          key={JSON.stringify([recipe.ingredients, recipe.steps, recipe.servings])}
          recipeId={recipe.id}
          ingredients={recipe.ingredients}
          steps={recipe.steps}
          servings={recipe.servings}
          meatIndex={mainMeatIndex(recipe)}
        />
        <section aria-label="Ratings">
          <h3>Ratings</h3>
          <dl className={styles.details}>
            {others.map((person) => {
              const stars = starsBy.get(person.user_id);
              return (
                <div key={person.user_id}>
                  <dt>{person.name}</dt>
                  <dd>{stars ? <span className={styles.stars} aria-label={`${stars} of 5 stars`}>{starsText(stars)}</span> : <span className={styles.unrated}>Not rated</span>}</dd>
                </div>
              );
            })}
            <div>
              <dt>You</dt>
              <dd>
                <RateRecipeForm recipeId={recipe.id} name={recipe.name} stars={mine} />
                {mine ? (
                  <form action={clearRecipeRating}>
                    <input type="hidden" name="recipe_id" value={recipe.id} />
                    <button type="submit" className={styles.linkButton}>
                      Clear my rating
                    </button>
                  </form>
                ) : null}
              </dd>
            </div>
          </dl>
        </section>
        {recipe.notes ? (
          <section aria-label="Notes">
            <h3>Notes</h3>
            <p>{recipe.notes}</p>
          </section>
        ) : null}
        {/* REQ-114: a recipe we won't make again leaves the library, kept. */}
        <form action={setHidden}>
          <input type="hidden" name="id" value={recipe.id} />
          <input type="hidden" name="hidden" value={recipe.hidden ? "no" : "yes"} />
          <button type="submit" className={styles.linkButton}>
            {recipe.hidden ? "Bring back to the library" : "Hide from the library"}
          </button>
        </form>
        <form action={removeRecipe}>
          <input type="hidden" name="id" value={recipe.id} />
          <button type="submit" className={styles.linkButton}>
            Remove this recipe
          </button>
        </form>
      </article>
    </MealPlansScreen>
  );
}
