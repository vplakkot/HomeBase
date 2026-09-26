import Link from "next/link";
import { notFound } from "next/navigation";
import { signedPhotoLinks } from "../../../lib/drinks/photos";
import { RECIPE_PHOTOS } from "../../../lib/meal-plans/photos";
import { cookTimeText, ingredientText, readRecipe } from "../../../lib/meal-plans/recipes";
import { removeRecipe } from "../actions";
import { MealPlansScreen, mealPlansViewer } from "../frame";
import styles from "../meal-plans.module.css";

const UUID = /^[0-9a-f-]{36}$/i;

// REQ-110: one recipe as one card: photo, links, the facts, ingredients
// with quantities, steps and notes. Times planned, last planned and
// ratings arrive with the weekly plan.
export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const viewer = await mealPlansViewer();
  const recipe = await readRecipe(viewer.supabase, id);
  if (!recipe) notFound();
  const photo = recipe.photo ? (await signedPhotoLinks(viewer.supabase, [recipe.photo], 60 * 60, RECIPE_PHOTOS)).get(recipe.photo) : undefined;
  const facts = [
    ["Cuisine", recipe.cuisine],
    ["Main meat", recipe.main_meat],
    ["Cooking method", recipe.cooking_method],
    ["Cook time", cookTimeText(recipe.cook_minutes)],
    ["Servings", recipe.servings ? String(recipe.servings) : null],
  ] as const;
  return (
    <MealPlansScreen viewer={viewer} crumb={recipe.name}>
      <article className={styles.formCard} aria-label={recipe.name}>
        <div className={styles.fileHead}>
          <h2 className={styles.title}>{recipe.name}</h2>
          <div className={styles.fileButtons}>
            <Link href={`/meal-plans/${recipe.id}/edit`}>Edit</Link>
          </div>
        </div>
        {photo ? <img src={photo} alt={recipe.name} className={styles.hero} /> : null}
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
        <section aria-label="Ingredients">
          <h3>Ingredients</h3>
          {recipe.ingredients.length === 0 ? (
            <p className={styles.empty}>None yet.</p>
          ) : (
            <ul className={styles.ingredients}>
              {recipe.ingredients.map((ingredient, index) => (
                <li key={index}>{ingredientText(ingredient)}</li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="Steps">
          <h3>Steps</h3>
          {recipe.steps.length === 0 ? (
            <p className={styles.empty}>None yet.</p>
          ) : (
            <ol className={styles.steps}>
              {recipe.steps.map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ol>
          )}
        </section>
        {recipe.notes ? (
          <section aria-label="Notes">
            <h3>Notes</h3>
            <p>{recipe.notes}</p>
          </section>
        ) : null}
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
