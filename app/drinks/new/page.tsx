import { DrinksScreen, drinksViewer } from "../frame";
import { DrinkForm } from "../forms";
import styles from "../drinks.module.css";

// REQ-37: add a drink by typing it in: from a menu, a recommendation, or
// a bad scan. Every field of the scan's review screen, all empty; only
// the name is required.
export default async function NewDrinkPage() {
  const viewer = await drinksViewer();
  return (
    <DrinksScreen viewer={viewer} crumb="Add a drink">
      <section className={styles.formCard} aria-label="Add a drink">
        <DrinkForm />
      </section>
    </DrinksScreen>
  );
}
