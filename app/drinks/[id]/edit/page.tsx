import { notFound } from "next/navigation";
import { DrinksScreen, drinksViewer } from "../../frame";
import { DrinkForm } from "../../forms";
import styles from "../../drinks.module.css";

// Change any of a drink's details; its ratings stay.
export default async function EditDrinkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await drinksViewer();
  const drink = viewer.drinks.find((row) => row.id === id);
  if (!drink) notFound();
  return (
    <DrinksScreen
      viewer={viewer}
      crumb={`Edit ${drink.name}`}
      parent={{ name: drink.name, href: `/drinks/${drink.id}` }}
    >
      <section className={styles.formCard} aria-label={`Edit ${drink.name}`}>
        <DrinkForm drink={drink} />
      </section>
    </DrinksScreen>
  );
}
