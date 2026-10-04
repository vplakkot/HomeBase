"use client";

import { useActionState } from "react";
import cards from "../../components/cards.module.css";
import { buttonClass } from "../../components/button";
import { PLAN_SERVINGS, type PlanServings } from "../../lib/meal-plans/plan";
import {
  addToPlan,
  changePlanStart,
  moveEntry,
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

// REQ-115: any day will do, usually a Sunday. Only offered while there is
// no plan; with one running, "Plan ahead" below sets up the next (REQ-162).
export function StartPlanForm({
  today,
  label = "Start a plan",
  dateLabel = "Starts on",
  thenWeek = false,
}: {
  today: string;
  label?: string;
  dateLabel?: string;
  thenWeek?: boolean;
}) {
  const [state, formAction, pending] = useActionState(startPlan, initialState);
  return (
    <form action={formAction} className={styles.inline}>
      {thenWeek ? <input type="hidden" name="then" value="week" /> : null}
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

// REQ-162: the next plan, queued behind the current one. It starts the day
// after the current plan's last meal, so there is no day to choose.
export function PlanAheadForm({ thenWeek = false }: { thenWeek?: boolean }) {
  const [state, formAction, pending] = useActionState(startPlan, initialState);
  return (
    <form action={formAction} className={styles.inline}>
      {thenWeek ? <input type="hidden" name="then" value="week" /> : null}
      <button type="submit" className={buttonClass} disabled={pending}>
        Plan ahead
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

// REQ-164: the next free meal unless one is chosen; an evening out is one
// dinner with no recipe.
export function AddToPlanForm({
  planId,
  recipes,
  meals,
}: {
  planId: string;
  recipes: readonly { id: string; name: string }[];
  meals: readonly { slot: number; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(addToPlan, initialState);
  return (
    <form action={formAction} className={styles.inline} aria-label="Add to the plan">
      <input type="hidden" name="plan_id" value={planId} />
      {recipes.length > 0 ? (
        <>
          <label className={styles.control}>
            <span>Recipe</span>
            <select name="recipe_id" defaultValue="">
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
        </>
      ) : null}
      <label className={styles.control}>
        <span>Meal</span>
        <select name="slot" defaultValue="">
          <option value="">Next free meal</option>
          {meals.map((meal) => (
            <option key={meal.slot} value={meal.slot}>
              {meal.label}
            </option>
          ))}
        </select>
      </label>
      {recipes.length > 0 ? (
        <button type="submit" name="intent" value="recipe" className={buttonClass} disabled={pending}>
          Add to plan
        </button>
      ) : null}
      <button type="submit" name="intent" value="eating_out" className={buttonClass} disabled={pending}>
        Eating out
      </button>
      <Outcome state={state} />
    </form>
  );
}

// One recipe's servings, cooked tick and carry-over tick, each saved as
// soon as it changes.
export function PlannedControls({
  planId,
  entryId,
  name,
  servings,
  cooked,
  carryOver,
}: {
  planId: string;
  entryId: string;
  name: string;
  servings: PlanServings;
  cooked: boolean;
  carryOver: boolean;
}) {
  return (
    <>
      <form action={setPlanServings}>
        <input type="hidden" name="plan_id" value={planId} />
        <input type="hidden" name="entry_id" value={entryId} />
        <label>
          <span className={styles.hidden}>Servings of {name}</span>
          <ServingsSelect defaultValue={servings} onChange={submitForm} />
        </label>
      </form>
      <form action={setCooked}>
        <input type="hidden" name="plan_id" value={planId} />
        <input type="hidden" name="entry_id" value={entryId} />
        <input type="hidden" name="cooked" value={cooked ? "no" : "yes"} />
        <label>
          <input type="checkbox" checked={cooked} onChange={submitForm} aria-label={`${name} cooked`} /> Cooked
        </label>
      </form>
      <form action={setCarryOver}>
        <input type="hidden" name="plan_id" value={planId} />
        <input type="hidden" name="entry_id" value={entryId} />
        <input type="hidden" name="carry_over" value={carryOver ? "no" : "yes"} />
        <label>
          <input type="checkbox" checked={carryOver} onChange={submitForm} aria-label={`Carry ${name} over`} /> Carry over
        </label>
      </form>
    </>
  );
}

// REQ-164: where an entry sits. "Move to..." picks a meal; the arrows go
// one place up or down. No dragging.
export function MoveControls({
  planId,
  entryId,
  name,
  meals,
  first,
  last,
}: {
  planId: string;
  entryId: string;
  name: string;
  meals: readonly { slot: number; label: string }[];
  first: boolean;
  last: boolean;
}) {
  return (
    <>
      <form action={moveEntry}>
        <input type="hidden" name="plan_id" value={planId} />
        <input type="hidden" name="entry_id" value={entryId} />
        <label>
          <span className={styles.hidden}>Move {name} to</span>
          <select name="slot" defaultValue="" onChange={submitForm}>
            <option value="" disabled>
              Move to…
            </option>
            {meals.map((meal) => (
              <option key={meal.slot} value={meal.slot}>
                {meal.label}
              </option>
            ))}
          </select>
        </label>
      </form>
      {(["up", "down"] as const).map((step) => (
        <form key={step} action={moveEntry}>
          <input type="hidden" name="plan_id" value={planId} />
          <input type="hidden" name="entry_id" value={entryId} />
          <input type="hidden" name="step" value={step} />
          <button type="submit" className={styles.linkButton} disabled={step === "up" ? first : last} aria-label={`Move ${name} ${step}`}>
            {step === "up" ? "Up" : "Down"}
          </button>
        </form>
      ))}
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
