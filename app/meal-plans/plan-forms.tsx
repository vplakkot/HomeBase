"use client";

import { useActionState } from "react";
import cards from "../../components/cards.module.css";
import { buttonClass } from "../../components/button";
import { PLAN_SERVINGS, type PlanServings } from "../../lib/meal-plans/plan";
import {
  addToPlan,
  changePlanStart,
  rateRecipe,
  setCarryOver,
  setCooked,
  setPlanServings,
  startPlan,
  type PlanFormState,
} from "./plan-actions";
import styles from "./meal-plans.module.css";

const initialState: PlanFormState = {};

function Outcome({ state }: { state: PlanFormState }) {
  return state.error ? (
    <p role="alert" className={cards.error}>
      {state.error}
    </p>
  ) : null;
}

const submitForm = (event: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => event.currentTarget.form?.requestSubmit();

// REQ-115: any day will do, usually a Sunday. With a plan open, starting
// the next one closes it (REQ-116).
export function StartPlanForm({ today, label = "Start a plan", dateLabel = "Starts on" }: { today: string; label?: string; dateLabel?: string }) {
  const [state, formAction, pending] = useActionState(startPlan, initialState);
  return (
    <form action={formAction} className={styles.inline}>
      <label className={styles.control}>
        <span>{dateLabel}</span>
        <input type="date" name="starts_on" defaultValue={today} required />
      </label>
      <button type="submit" className={buttonClass} disabled={pending}>
        {label}
      </button>
      <Outcome state={state} />
    </form>
  );
}

export function ChangeStartForm({ planId, startsOn }: { planId: string; startsOn: string }) {
  const [state, formAction] = useActionState(changePlanStart, initialState);
  return (
    <form action={formAction} className={styles.inline}>
      <input type="hidden" name="plan_id" value={planId} />
      <label className={styles.control}>
        <span>Starts on</span>
        <input type="date" name="starts_on" defaultValue={startsOn} required onChange={submitForm} />
      </label>
      <Outcome state={state} />
    </form>
  );
}

function ServingsSelect({ defaultValue, onChange }: { defaultValue: PlanServings; onChange?: typeof submitForm }) {
  return (
    <select name="servings" defaultValue={String(defaultValue)} onChange={onChange}>
      {PLAN_SERVINGS.map((servings) => (
        <option key={servings} value={servings}>
          {servings === 4 ? "4 servings" : "2 servings"}
        </option>
      ))}
    </select>
  );
}

export function AddToPlanForm({ planId, recipes }: { planId: string; recipes: readonly { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(addToPlan, initialState);
  if (recipes.length === 0) return null;
  return (
    <form action={formAction} className={styles.inline} aria-label="Add a recipe to the plan">
      <input type="hidden" name="plan_id" value={planId} />
      <label className={styles.control}>
        <span>Recipe</span>
        <select name="recipe_id" required defaultValue="">
          <option value="" disabled>
            Choose a recipe
          </option>
          {recipes.map((recipe) => (
            <option key={recipe.id} value={recipe.id}>
              {recipe.name}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.control}>
        <span>Servings</span>
        <ServingsSelect defaultValue={4} />
      </label>
      <button type="submit" className={buttonClass} disabled={pending}>
        Add
      </button>
      <Outcome state={state} />
    </form>
  );
}

// One recipe's servings, cooked tick and carry-over tick, each saved as
// soon as it changes.
export function PlannedControls({
  planId,
  recipeId,
  name,
  servings,
  cooked,
  carryOver,
}: {
  planId: string;
  recipeId: string;
  name: string;
  servings: PlanServings;
  cooked: boolean;
  carryOver: boolean;
}) {
  return (
    <>
      <form action={setPlanServings}>
        <input type="hidden" name="plan_id" value={planId} />
        <input type="hidden" name="recipe_id" value={recipeId} />
        <label>
          <span className={styles.hidden}>Servings of {name}</span>
          <ServingsSelect defaultValue={servings} onChange={submitForm} />
        </label>
      </form>
      <form action={setCooked}>
        <input type="hidden" name="plan_id" value={planId} />
        <input type="hidden" name="recipe_id" value={recipeId} />
        <input type="hidden" name="cooked" value={cooked ? "no" : "yes"} />
        <label>
          <input type="checkbox" checked={cooked} onChange={submitForm} aria-label={`${name} cooked`} /> Cooked
        </label>
      </form>
      <form action={setCarryOver}>
        <input type="hidden" name="plan_id" value={planId} />
        <input type="hidden" name="recipe_id" value={recipeId} />
        <input type="hidden" name="carry_over" value={carryOver ? "no" : "yes"} />
        <label>
          <input type="checkbox" checked={carryOver} onChange={submitForm} aria-label={`Carry ${name} over`} /> Carry over
        </label>
      </form>
    </>
  );
}

// On a recipe's card or a suggestion: straight into the open plan, at 4 servings.
export function AddToWeekButton({ planId, recipeId, label = "Add to this week" }: { planId: string; recipeId: string; label?: string }) {
  const [state, formAction, pending] = useActionState(addToPlan, initialState);
  return (
    <form action={formAction}>
      <input type="hidden" name="plan_id" value={planId} />
      <input type="hidden" name="recipe_id" value={recipeId} />
      <input type="hidden" name="servings" value="4" />
      <button type="submit" className={styles.linkButton} disabled={pending}>
        {label}
      </button>
      <Outcome state={state} />
    </form>
  );
}

// REQ-116: five stars, saved as soon as one is tapped. Tapping another
// changes it.
export function RateRecipeForm({ recipeId, name, stars }: { recipeId: string; name: string; stars: number | null }) {
  const [state, formAction, pending] = useActionState(rateRecipe, initialState);
  return (
    <form action={formAction}>
      <input type="hidden" name="recipe_id" value={recipeId} />
      <fieldset className={styles.starPicker} disabled={pending}>
        <legend className={styles.hidden}>Your rating of {name}</legend>
        {[1, 2, 3, 4, 5].map((value) => (
          <label key={value} className={styles.star}>
            <input type="radio" name="stars" value={value} defaultChecked={stars === value} onChange={submitForm} />
            <span aria-hidden="true">★</span>
            <span className={styles.hidden}>{value === 1 ? "1 star" : `${value} stars`}</span>
          </label>
        ))}
      </fieldset>
      <Outcome state={state} />
    </form>
  );
}
