import { notFound } from "next/navigation";
import { readCuisines, readRecipe } from "../../../../lib/meal-plans/recipes";
import { MealPlansScreen, mealPlansViewer } from "../../frame";
import { PhotoForm, RecipeForm } from "../../forms";
import styles from "../../meal-plans.module.css";

const UUID = /^[0-9a-f-]{36}$/i;

// Change any part of a recipe, and its photo (REQ-110).
export default async function EditRecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const viewer = await mealPlansViewer();
  const [recipe, cuisines] = await Promise.all([readRecipe(viewer.supabase, id), readCuisines(viewer.supabase)]);
  if (!recipe) notFound();
  return (
    <MealPlansScreen viewer={viewer} section="Recipes" crumb={`Edit ${recipe.name}`}>
      <section className={styles.formCard} aria-label={`Edit ${recipe.name}`}>
        <PhotoForm recipeId={recipe.id} />
        <RecipeForm recipe={recipe} cuisines={cuisines} />
      </section>
    </MealPlansScreen>
  );
}
