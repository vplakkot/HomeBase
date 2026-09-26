import { MealPlansScreen, mealPlansViewer } from "../frame";
import { AddRecipe } from "../forms";
import styles from "../meal-plans.module.css";

// REQ-111, REQ-112: add a recipe from a video (BETA), from text in any
// form, or by filling in an empty card.
export default async function NewRecipePage() {
  const viewer = await mealPlansViewer();
  return (
    <MealPlansScreen viewer={viewer} crumb="Add recipe" actions={<span />}>
      <section className={styles.formCard} aria-label="Add recipe">
        <AddRecipe />
      </section>
    </MealPlansScreen>
  );
}
