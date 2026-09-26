import Link from "next/link";
import { signedPhotoLinks, thumbPath } from "../../lib/drinks/photos";
import { RECIPE_PHOTOS } from "../../lib/meal-plans/photos";
import { cookTimeText, readImports, readRecipes } from "../../lib/meal-plans/recipes";
import { dismissImport } from "./actions";
import { MealPlansScreen, mealPlansViewer } from "./frame";
import styles from "./meal-plans.module.css";

const STATUS: Record<string, string> = {
  uploading: "Sending the video",
  processing: "Gemini is reading it",
  ready: "Ready to review",
  failed: "Couldn't be read",
};

// Meal Plan's home for now: recipes on their way in, then every recipe.
// The library (REQ-114) and the weekly plan come in later batches.
export default async function MealPlansPage() {
  const viewer = await mealPlansViewer();
  const [recipes, imports] = await Promise.all([readRecipes(viewer.supabase), readImports(viewer.supabase)]);
  const thumbs = await signedPhotoLinks(
    viewer.supabase,
    recipes.flatMap((recipe) => (recipe.photo ? [thumbPath(recipe.photo)] : [])),
    60 * 60,
    RECIPE_PHOTOS,
  );
  return (
    <MealPlansScreen viewer={viewer}>
      {imports.length > 0 ? (
        <section className={styles.section} aria-label="On their way">
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>On their way</h2>
          </div>
          <ul className={styles.grid}>
            {imports.map((item) => (
              <li key={item.id} className={styles.card}>
                <Link href={`/meal-plans/drafts/${item.id}`} className={styles.cardTitle}>
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
      <section className={styles.section} aria-label="Recipes">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Recipes</h2>
          <span className={styles.count}>{recipes.length}</span>
        </div>
        {recipes.length === 0 ? (
          <p className={styles.empty}>No recipes yet.</p>
        ) : (
          <ul className={styles.grid}>
            {recipes.map((recipe) => {
              const thumb = recipe.photo ? thumbs.get(thumbPath(recipe.photo)) : undefined;
              return (
                <li key={recipe.id}>
                  <Link href={`/meal-plans/${recipe.id}`} className={`${styles.linkCard} ${thumb ? styles.withThumb : ""}`}>
                    {thumb ? <img src={thumb} alt="" className={styles.thumb} /> : null}
                    <span className={styles.cardTitle}>{recipe.name}</span>
                    <span className={styles.cardDetail}>
                      {[recipe.cuisine, recipe.main_meat, recipe.cooking_method, cookTimeText(recipe.cook_minutes)].filter(Boolean).join(" · ")}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </MealPlansScreen>
  );
}
