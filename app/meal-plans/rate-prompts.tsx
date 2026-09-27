import Link from "next/link";
import { skipRating } from "./plan-actions";
import { RateRecipeForm } from "./plan-forms";
import styles from "./meal-plans.module.css";

// REQ-116: after a plan closes, each of us is asked, on our own device,
// to rate the dishes cooked for the first time. The question stays until
// it's answered or skipped.
export function RatePrompts({ recipes }: { recipes: readonly { id: string; name: string }[] }) {
  if (recipes.length === 0) return null;
  return (
    <section className={styles.section} aria-label="Rate what we cooked">
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Rate what we cooked</h2>
      </div>
      <ul className={styles.planList}>
        {recipes.map((recipe) => (
          <li key={recipe.id} className={styles.planRow}>
            <Link href={`/meal-plans/${recipe.id}`}>{recipe.name}</Link>
            <RateRecipeForm recipeId={recipe.id} name={recipe.name} stars={null} />
            <form action={skipRating}>
              <input type="hidden" name="recipe_id" value={recipe.id} />
              <button type="submit" className={styles.linkButton} aria-label={`Skip rating ${recipe.name}`}>
                Skip
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
