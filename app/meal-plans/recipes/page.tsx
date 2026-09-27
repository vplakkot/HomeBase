import Link from "next/link";
import { signedPhotoLinks, thumbPath } from "../../../lib/drinks/photos";
import { libraryRecipes, type LibraryQuery } from "../../../lib/meal-plans/library";
import { RECIPE_PHOTOS } from "../../../lib/meal-plans/photos";
import { readPlanStats } from "../../../lib/meal-plans/plan";
import { cookTimeText, readCuisines, readRecipes } from "../../../lib/meal-plans/recipes";
import { MealPlansScreen, mealPlansViewer } from "../frame";
import { LibraryFilters, LibrarySearch } from "../library-controls";
import styles from "../meal-plans.module.css";

// REQ-114: every recipe as a photo card, to search, filter and sort.
// Hidden recipes have a list of their own, where they can come back.
export default async function RecipesPage({ searchParams }: { searchParams: Promise<LibraryQuery> }) {
  const [viewer, query] = await Promise.all([mealPlansViewer(), searchParams]);
  const [all, stats, cuisines] = await Promise.all([
    readRecipes(viewer.supabase),
    readPlanStats(viewer.supabase),
    readCuisines(viewer.supabase),
  ]);
  const recipes = libraryRecipes(all, stats, query);
  const hiddenCount = all.filter((recipe) => recipe.hidden).length;
  const showingHidden = query.hidden === "yes";
  const thumbs = await signedPhotoLinks(
    viewer.supabase,
    recipes.flatMap((recipe) => (recipe.photo ? [thumbPath(recipe.photo)] : [])),
    60 * 60,
    RECIPE_PHOTOS,
  );
  return (
    <MealPlansScreen viewer={viewer} section="Recipes" tools={<LibrarySearch query={query} />}>
      <LibraryFilters query={query} cuisines={cuisines} />
      <section className={styles.section} aria-label={showingHidden ? "Hidden recipes" : "Recipes"}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{showingHidden ? "Hidden recipes" : "Recipes"}</h2>
          <span className={styles.count}>{recipes.length}</span>
        </div>
        {recipes.length === 0 ? (
          <p className={styles.empty}>{all.length === 0 ? "No recipes yet." : "No recipes match."}</p>
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
        {showingHidden ? (
          <Link href="/meal-plans/recipes" className={styles.textLink}>
            Back to the library
          </Link>
        ) : hiddenCount > 0 ? (
          <Link href="/meal-plans/recipes?hidden=yes" className={styles.textLink}>
            Hidden recipes ({hiddenCount})
          </Link>
        ) : null}
      </section>
    </MealPlansScreen>
  );
}
