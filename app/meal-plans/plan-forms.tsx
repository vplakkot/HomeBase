"use client";

import { useActionState, useState } from "react";
import cards from "../../components/cards.module.css";
import { buttonClass } from "../../components/button";
import type { EntrySize } from "../../lib/meal-plans/meals";
import { PLAN_SIZES } from "../../lib/meal-plans/plan";
import {
  addToPlan,
  changePlanStart,
  markDayOff,
  moveEntry,
  rateRecipe,
  setPlanMeals,
  setRepeatRecipes,
  startPlan,
  unmarkDayOff,
  type PlanFormState,
} from "./plan-actions";
import styles from "./meal-plans.module.css";

const initialState: PlanFormState = {};

function Outcome({ state }: { state: PlanFormState }) {
  if (state.error) {
    return (
      <p role="alert" className={cards.error}>
        {state.error}
      </p>
    );
  }
  return state.notice ? <p role="status">{state.notice}</p> : null;
}

const submitForm = (event: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => event.currentTarget.form?.requestSubmit();

// REQ-115: any day will do, usually a Sunday. Only offered while there is
// no plan; with one running, "Plan next week" below sets up the next (REQ-162, REQ-170).
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
      <label className={styles.control}>
        <span>First meal</span>
        <select name="starts_meal" defaultValue="dinner">
          <option value="dinner">Dinner</option>
          <option value="lunch">Lunch (weekends)</option>
        </select>
      </label>
      <button type="submit" className={buttonClass} disabled={pending}>
        {label}
      </button>
      <Outcome state={state} />
    </form>
  );
}

// REQ-172: the one Meal Plan setting, saved as soon as it changes.
export function RepeatRecipesSetting({ on }: { on: boolean }) {
  return (
    <form action={setRepeatRecipes}>
      <input type="hidden" name="repeat" value={on ? "no" : "yes"} />
      <label>
        <input type="checkbox" checked={on} onChange={submitForm} /> Repeat recipes in a plan
      </label>
    </form>
  );
}

// The module home's "New meal plan": one press makes the plan (today, at
// dinner) and goes straight to it, instead of to a page that asks again.
export function NewPlanForm({ today }: { today: string }) {
  const [state, formAction, pending] = useActionState(startPlan, initialState);
  return (
    <form action={formAction} className={styles.inline}>
      <input type="hidden" name="then" value="week" />
      <input type="hidden" name="starts_on" value={today} />
      <button type="submit" className={buttonClass} disabled={pending}>
        New meal plan
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
        Plan next week
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

// The key is the saved size, on purpose (REQ-176): a select left to itself
// only reads defaultValue when it first appears, and React puts a form back
// to those first values after it saves. Without the key the picker went back
// to the size it started with while the plan showed the new one.
function SizeSelect({ defaultValue, name = "meals", onChange }: { defaultValue: EntrySize; name?: string; onChange?: typeof submitForm }) {
  return (
    <select key={defaultValue} name={name} defaultValue={String(defaultValue)} onChange={onChange}>
      {PLAN_SIZES.map((size) => (
        <option key={size} value={size}>
          {size === 2 ? "2 meals" : "1 meal"}
        </option>
      ))}
    </select>
  );
}

export type MealOption = { value: string; label: string };

// REQ-168: the next free meal it can start at unless one is chosen; an
// evening out is one dinner with no recipe. Which meals a dish can start at
// depends on its size, so the list follows the size picked.
export function AddToPlanForm({
  planId,
  recipes,
  choices,
}: {
  planId: string;
  recipes: readonly { id: string; name: string }[];
  choices: { one: readonly MealOption[]; two: readonly MealOption[] };
}) {
  const [state, formAction, pending] = useActionState(addToPlan, initialState);
  const [size, setSize] = useState<EntrySize>(2);
  // REQ-180: a name that is already a recipe picks that recipe in the list.
  const [picked, setPicked] = useState("");
  const [seen, setSeen] = useState<PlanFormState>(initialState);
  if (state !== seen) {
    setSeen(state);
    if (state.existingId && recipes.some((recipe) => recipe.id === state.existingId)) setPicked(state.existingId);
    else if (!state.error) setPicked("");
  }
  return (
    <form action={formAction} className={styles.addForm} aria-label="Add to the plan">
      <input type="hidden" name="plan_id" value={planId} />
      <div className={styles.inline}>
        {recipes.length > 0 ? (
          <label className={`${styles.control} ${styles.grow}`}>
            <span>Recipe</span>
            <select key={picked} name="recipe_id" defaultValue={picked}>
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
        ) : null}
        <label className={`${styles.control} ${styles.grow}`}>
          <span>{recipes.length > 0 ? "Or a new recipe" : "New recipe"}</span>
          <input type="text" name="new_name" placeholder="Recipe name" autoComplete="off" />
        </label>
      </div>
      <div className={styles.inline}>
        <label className={styles.control}>
          <span>Size</span>
          <SizeSelect defaultValue={2} onChange={(event) => setSize(Number(event.currentTarget.value) as EntrySize)} />
        </label>
        <label className={styles.control}>
          <span>Meal</span>
          <select key={size} name="meal" defaultValue="">
            <option value="">Next free meal</option>
            {(size === 2 ? choices.two : choices.one).map((meal) => (
              <option key={meal.value} value={meal.value}>
                {meal.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.inline}>
        {recipes.length > 0 ? (
          <button type="submit" name="intent" value="recipe" className={buttonClass} disabled={pending}>
            Add to plan
          </button>
        ) : null}
        <button type="submit" name="intent" value="new_recipe" className={buttonClass} disabled={pending}>
          Add new recipe
        </button>
        <button type="submit" name="intent" value="eating_out" className={buttonClass} disabled={pending}>
          Eating out
        </button>
      </div>
      <Outcome state={state} />
    </form>
  );
}

// One dish's size, saved as soon as it changes. (The cooked and carry-over
// ticks went with REQ-163: closing cards and "Didn't cook this" replace them.)
export function PlannedControls({ planId, entryId, name, meals }: { planId: string; entryId: string; name: string; meals: EntrySize }) {
  const [state, formAction] = useActionState(setPlanMeals, initialState);
  return (
    <form action={formAction}>
      <input type="hidden" name="plan_id" value={planId} />
      <input type="hidden" name="entry_id" value={entryId} />
      <label>
        <span className={styles.hidden}>Size of {name}</span>
        <SizeSelect defaultValue={meals} onChange={submitForm} />
      </label>
      <Outcome state={state} />
    </form>
  );
}

// REQ-168: where an entry sits. "Move to..." picks a meal it can start at;
// the arrows swap a dish with the dish next to it. No dragging. Eating out
// is fixed in place: it has no arrows, and dishes settle round it.
export function MoveControls({
  planId,
  entryId,
  name,
  meals,
  canMoveUp,
  canMoveDown,
}: {
  planId: string;
  entryId: string;
  name: string;
  meals: readonly MealOption[];
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const [state, formAction] = useActionState(moveEntry, initialState);
  return (
    <>
      <form action={formAction}>
        <input type="hidden" name="plan_id" value={planId} />
        <input type="hidden" name="entry_id" value={entryId} />
        <label>
          <span className={styles.hidden}>Move {name} to</span>
          <select name="meal" defaultValue="" onChange={submitForm}>
            <option value="" disabled>
              Move to…
            </option>
            {meals.map((meal) => (
              <option key={meal.value} value={meal.value}>
                {meal.label}
              </option>
            ))}
          </select>
        </label>
        <Outcome state={state} />
      </form>
      {(["up", "down"] as const).map((step) => (
        <form key={step} action={formAction}>
          <input type="hidden" name="plan_id" value={planId} />
          <input type="hidden" name="entry_id" value={entryId} />
          <input type="hidden" name="step" value={step} />
          <button type="submit" className={styles.linkButton} disabled={step === "up" ? !canMoveUp : !canMoveDown} aria-label={`Move ${name} ${step}`}>
            {step === "up" ? "Up" : "Down"}
          </button>
        </form>
      ))}
    </>
  );
}

// REQ-168: days we marked as a Day off in this plan (a holiday, a day taken
// off). Either of us can mark one; it lets a 2-meal dish start at that
// day's lunch, like a weekend.
export function DaysOffForm({ planId, days }: { planId: string; days: readonly { day: string; label: string }[] }) {
  const [state, formAction, pending] = useActionState(markDayOff, initialState);
  const [removed, removeAction] = useActionState(unmarkDayOff, initialState);
  return (
    <>
      <form action={formAction} className={styles.inline}>
        <input type="hidden" name="plan_id" value={planId} />
        <label className={styles.control}>
          <span>Day off</span>
          <input type="date" name="day" required />
        </label>
        <button type="submit" className={buttonClass} disabled={pending}>
          Mark as a day off
        </button>
        <Outcome state={state} />
      </form>
      {days.length > 0 ? (
        <ul className={styles.planList} aria-label="Days off">
          {days.map(({ day, label }) => (
            <li key={day} className={styles.planRow}>
              <span>{label}</span>
              <form action={removeAction}>
                <input type="hidden" name="plan_id" value={planId} />
                <input type="hidden" name="day" value={day} />
                <button type="submit" className={styles.linkButton} aria-label={`Not a day off: ${label}`}>
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}
      <Outcome state={removed} />
    </>
  );
}

// On a recipe's card or a suggestion: straight into the open plan, as a 2-meal dish.
export function AddToWeekButton({ planId, recipeId, label = "Add to this week" }: { planId: string; recipeId: string; label?: string }) {
  const [state, formAction, pending] = useActionState(addToPlan, initialState);
  return (
    <form action={formAction}>
      <input type="hidden" name="plan_id" value={planId} />
      <input type="hidden" name="recipe_id" value={recipeId} />
      <input type="hidden" name="meals" value="2" />
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
