"use client";

import { useActionState, useState } from "react";
import cards from "../../components/cards.module.css";
import { buttonClass } from "../../components/button";
import { ingredientText, type Ingredient } from "../../lib/meal-plans/recipes";
import { formatNumber, isFactor, parseNumber, scaleRecipe } from "../../lib/meal-plans/scale";
import { saveScaled, type PlanFormState } from "./plan-actions";
import styles from "./meal-plans.module.css";

// REQ-113: change the servings or the main meat, and the card's
// ingredients and steps follow by the same ratio. Nothing is saved until
// "Save these amounts"; then they become the card's own.
export function ScaledRecipe({
  recipeId,
  ingredients,
  steps,
  servings,
  meatIndex,
}: {
  recipeId: string;
  ingredients: Ingredient[];
  steps: string[];
  servings: number | null;
  meatIndex: number;
}) {
  const meat = meatIndex >= 0 ? ingredients[meatIndex] : null;
  const meatAmount = meat ? parseNumber(meat.quantity) : null;
  const [factor, setFactor] = useState(1);
  const [servingsText, setServingsText] = useState(servings ? String(servings) : "");
  const [meatText, setMeatText] = useState(meat?.quantity ?? "");
  const [state, formAction, pending] = useActionState(saveScaled, {} as PlanFormState);
  const scaled = scaleRecipe({ ingredients, steps, servings }, factor);
  const changeServings = (text: string) => {
    setServingsText(text);
    const value = Number(text);
    if (!servings || !Number.isFinite(value) || !isFactor(value / servings)) return;
    const next = value / servings;
    setFactor(next);
    if (meat && meatAmount) setMeatText(formatNumber(meatAmount * next, meat.unit));
  };
  const changeMeat = (text: string) => {
    setMeatText(text);
    const value = parseNumber(text);
    if (!meatAmount || value === null || !isFactor(value / meatAmount)) return;
    const next = value / meatAmount;
    setFactor(next);
    if (servings) setServingsText(String(Math.max(1, Math.round(servings * next))));
  };
  const reset = () => {
    setFactor(1);
    setServingsText(servings ? String(servings) : "");
    setMeatText(meat?.quantity ?? "");
  };
  return (
    <>
      {servings || meat ? (
        <form action={formAction} className={styles.scale} aria-label="Scale">
          <input type="hidden" name="id" value={recipeId} />
          <input type="hidden" name="factor" value={factor} />
          {servings ? (
            <label className={styles.control}>
              <span>Servings</span>
              <input type="number" inputMode="numeric" min={1} value={servingsText} onChange={(event) => changeServings(event.target.value)} />
            </label>
          ) : null}
          {meat ? (
            <label className={styles.control}>
              <span>{[meat.unit, meat.item].filter(Boolean).join(" ")}</span>
              <input inputMode="decimal" value={meatText} onChange={(event) => changeMeat(event.target.value)} />
            </label>
          ) : null}
          {factor !== 1 ? (
            <>
              <button type="submit" className={buttonClass} disabled={pending}>
                Save these amounts
              </button>
              <button type="button" className={styles.linkButton} onClick={reset}>
                Back to the card
              </button>
            </>
          ) : null}
          <Outcome state={state} />
        </form>
      ) : null}
      <section aria-label="Ingredients">
        <h3>Ingredients</h3>
        {scaled.ingredients.length === 0 ? (
          <p className={styles.empty}>None yet.</p>
        ) : (
          <ul className={styles.ingredients}>
            {scaled.ingredients.map((ingredient, index) => (
              <li key={index}>{ingredientText(ingredient)}</li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Steps">
        <h3>Steps</h3>
        {scaled.steps.length === 0 ? (
          <p className={styles.empty}>None yet.</p>
        ) : (
          <ol className={styles.steps}>
            {scaled.steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

function Outcome({ state }: { state: PlanFormState }) {
  return state.error ? (
    <p role="alert" className={cards.error}>
      {state.error}
    </p>
  ) : null;
}
