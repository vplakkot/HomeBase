import Link from "next/link";
import { coversThrough, dayLabel, readOpenPlan } from "../../lib/meal-plans/plan";
import { readImports, readRecipes } from "../../lib/meal-plans/recipes";
import { dismissImport } from "./actions";
import { MealPlansScreen, mealPlansViewer } from "./frame";
import styles from "./meal-plans.module.css";

const STATUS: Record<string, string> = {
  uploading: "Sending the video",
  processing: "Gemini is reading it",
  ready: "Ready to review",
  failed: "Couldn't be read",
};

// Meal Plan's home for now: recipes on their way in, this week's plan and
// the way to the library. The module's real home is a later batch.
export default async function MealPlansPage() {
  const viewer = await mealPlansViewer();
  const [all, imports, plan] = await Promise.all([
    readRecipes(viewer.supabase),
    readImports(viewer.supabase),
    readOpenPlan(viewer.supabase),
  ]);
  const recipes = all.filter((recipe) => !recipe.hidden);
  const names = new Map(all.map((recipe) => [recipe.id, recipe.name]));
  const planned = plan?.recipes.filter((entry) => names.has(entry.recipe_id)) ?? [];
  const through = plan ? coversThrough(plan.starts_on, planned) : null;
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
      <section className={styles.section} aria-label="This week">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>This week</h2>
        </div>
        {plan ? (
          <Link href="/meal-plans/week" className={styles.linkCard}>
            <span className={styles.cardTitle}>
              {through ? `Covers you through at least ${dayLabel(through)}` : `From ${dayLabel(plan.starts_on)}`}
            </span>
            <span className={styles.cardDetail}>
              {planned.length === 0 ? "No recipes yet" : planned.map((entry) => names.get(entry.recipe_id)).join(" · ")}
            </span>
          </Link>
        ) : (
          <Link href="/meal-plans/week" className={styles.linkCard}>
            <span className={styles.cardTitle}>No plan yet</span>
            <span className={styles.cardDetail}>Start one</span>
          </Link>
        )}
      </section>
      <section className={styles.section} aria-label="Recipes">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Recipes</h2>
        </div>
        <Link href="/meal-plans/recipes" className={styles.linkCard}>
          <span className={styles.cardTitle}>{recipes.length === 1 ? "1 recipe" : `${recipes.length} recipes`}</span>
          <span className={styles.cardDetail}>Search, filter and sort the library</span>
        </Link>
      </section>
    </MealPlansScreen>
  );
}
