"use client";

import { useActionState, useEffect, useState } from "react";
import cards from "../../components/cards.module.css";
import { HOW_NAMES, HOWS, vintageText, type Drink, type How, type Rating } from "../../lib/drinks/drinks";
import { BOTTLE_SIZES, COUNTRIES, DRINK_TYPES, GRAPES, METHODS, REGIONS, SWEETNESS, TYPE_NAMES } from "../../lib/drinks/lists";
import { addDrink, clearRating, rateDrink, removeDrink, updateDrink, type FormState } from "./actions";
import styles from "./drinks.module.css";

const initialState: FormState = {};

function Outcome({ state }: { state: FormState }) {
  return state.error ? (
    <p role="alert" className={cards.error}>
      {state.error}
    </p>
  ) : null;
}

function useOnSaved(state: FormState, onSaved?: () => void) {
  useEffect(() => {
    if (state.saved) onSaved?.();
  }, [state, onSaved]);
}

// The suggestions each field offers, from the standard lists (REQ-37).
// A suggestion is only a suggestion: anything typed is kept.
function Suggestions() {
  return (
    <>
      <datalist id="grape-list">
        {GRAPES.flatMap((grape) => [grape.name, ...(grape.also ?? [])]).map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <datalist id="region-list">
        {REGIONS.map((region) => (
          <option key={region.name} value={region.name} />
        ))}
      </datalist>
      <datalist id="country-list">
        {COUNTRIES.map((country) => (
          <option key={country} value={country} />
        ))}
      </datalist>
      <datalist id="sweetness-list">
        {SWEETNESS.map((term) => (
          <option key={term} value={term} />
        ))}
      </datalist>
      <datalist id="method-list">
        {METHODS.map((method) => (
          <option key={method} value={method} />
        ))}
      </datalist>
    </>
  );
}

function Field({
  label,
  name,
  value,
  list,
  placeholder,
  inputMode,
  type = "text",
}: {
  label: string;
  name: string;
  value: string;
  list?: string;
  placeholder?: string;
  inputMode?: "numeric" | "decimal";
  type?: string;
}) {
  return (
    <label className={cards.field}>
      <span>{label}</span>
      <input name={name} type={type} defaultValue={value} list={list} placeholder={placeholder} inputMode={inputMode} autoComplete="off" />
    </label>
  );
}

// REQ-35: one "How we got it" value, and only the extras that go with
// it. Changing the value later is normal: Want to try becomes Bought.
function HowWeGotIt({ drink }: { drink?: Drink }) {
  const [how, setHow] = useState<How | "">(drink?.how ?? "");
  return (
    <fieldset className={styles.choices}>
      <legend>How we got it</legend>
      <div className={styles.choiceRow}>
        {HOWS.map((value) => (
          <label key={value} className={styles.choice}>
            <input
              type="radio"
              name="how"
              value={value}
              required
              checked={how === value}
              onChange={() => setHow(value)}
            />
            <span>{HOW_NAMES[value]}</span>
          </label>
        ))}
      </div>
      {how === "bought" ? (
        <div className={styles.pairFields}>
          <Field label="Price (optional)" name="price" value={drink?.price ?? ""} placeholder="$24.99" />
          <Field label="Where we bought it (optional)" name="place" value={drink?.place ?? ""} />
        </div>
      ) : null}
      {how === "gift" ? <Field label="Who it was from (optional)" name="gift_from" value={drink?.gift_from ?? ""} /> : null}
      {how === "had_out" ? <Field label="Where we had it (optional)" name="place" value={drink?.place ?? ""} /> : null}
    </fieldset>
  );
}

// REQ-37: a drink's details, every one optional except the name and how
// we got it. The same fields as the scan's review screen (REQ-28, a
// later batch), which will reuse this form filled in. With `drink`, it
// changes that drink.
export function DrinkForm({ drink }: { drink?: Drink }) {
  const [state, formAction, pending] = useActionState(drink ? updateDrink : addDrink, initialState);
  const [grapes, setGrapes] = useState<string[]>(drink && drink.grapes.length > 0 ? drink.grapes : [""]);
  const [type, setType] = useState<string>(drink?.type ?? "");
  const sparkling = type === "sparkling";
  return (
    <form action={formAction} className={`${cards.form} ${styles.drinkForm}`}>
      {drink ? <input type="hidden" name="id" value={drink.id} /> : null}
      <Suggestions />
      <label className={cards.field}>
        <span>Name</span>
        <input name="name" required defaultValue={drink?.name ?? ""} placeholder="Wine name or cuvée" autoComplete="off" />
      </label>
      <HowWeGotIt drink={drink} />
      <Field label="Producer (optional)" name="producer" value={drink?.producer ?? ""} />
      <div className={styles.pairFields}>
        <label className={cards.field}>
          <span>Type (optional)</span>
          <select name="type" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">Not set</option>
            {DRINK_TYPES.map((value) => (
              <option key={value} value={value}>
                {TYPE_NAMES[value]}
              </option>
            ))}
          </select>
        </label>
        <Field
          label="Vintage (optional)"
          name="vintage"
          value={drink ? (vintageText(drink) ?? "") : ""}
          placeholder="2019 or NV"
        />
      </div>
      <fieldset className={styles.grapes}>
        <legend>Grapes (optional)</legend>
        {grapes.map((grape, index) => (
          <label key={index} className={cards.field}>
            <span className={styles.hiddenLabel}>Grape {index + 1}</span>
            <input
              name="grape"
              list="grape-list"
              value={grape}
              autoComplete="off"
              onChange={(event) => setGrapes((now) => now.map((old, at) => (at === index ? event.target.value : old)))}
            />
          </label>
        ))}
        <button type="button" className={cards.quiet} onClick={() => setGrapes((now) => [...now, ""])}>
          Add another grape
        </button>
      </fieldset>
      <div className={styles.pairFields}>
        <Field label="Region (optional)" name="region" value={drink?.region ?? ""} list="region-list" />
        <Field label="Country (optional)" name="country" value={drink?.country ?? ""} list="country-list" />
      </div>
      <div className={styles.pairFields}>
        <Field
          label="Alcohol % (optional)"
          name="abv"
          value={drink?.abv === null || drink?.abv === undefined ? "" : String(drink.abv)}
          placeholder="13.5"
          inputMode="decimal"
        />
        <label className={cards.field}>
          <span>Bottle size (optional)</span>
          <select name="bottle_ml" defaultValue={drink?.bottle_ml ? String(drink.bottle_ml) : ""}>
            <option value="">Not set</option>
            {BOTTLE_SIZES.map((size) => (
              <option key={size.ml} value={size.ml}>
                {size.name}
              </option>
            ))}
            {drink?.bottle_ml && !BOTTLE_SIZES.some((size) => size.ml === drink.bottle_ml) ? (
              <option value={drink.bottle_ml}>{drink.bottle_ml} ml</option>
            ) : null}
          </select>
        </label>
      </div>
      {/* REQ-27: sparkling wines also have a sweetness, a method and a
          disgorgement date. Hidden for other types, and not sent. */}
      {sparkling ? (
        <div className={styles.pairFields}>
          <Field label="Sweetness (optional)" name="sweetness" value={drink?.sweetness ?? ""} list="sweetness-list" />
          <Field label="Method (optional)" name="method" value={drink?.method ?? ""} list="method-list" />
          <Field label="Disgorged (optional)" name="disgorged_on" value={drink?.disgorged_on ?? ""} type="date" />
        </div>
      ) : null}
      <button type="submit" className={cards.primary} disabled={pending}>
        {pending ? "Saving…" : drink ? "Save changes" : "Add the drink"}
      </button>
      <Outcome state={state} />
    </form>
  );
}

// REQ-29: whole stars and an optional one-line comment. Rating again
// shows what you gave before and saving replaces it.
export function RateForm({ drinkId, rating, onSaved }: { drinkId: string; rating: Rating | null; onSaved: () => void }) {
  const [state, formAction, pending] = useActionState(rateDrink, initialState);
  const [cleared, clearAction, clearing] = useActionState(clearRating, initialState);
  useOnSaved(state, onSaved);
  useOnSaved(cleared, onSaved);
  return (
    <div className={cards.form}>
      <form action={formAction} className={styles.rateForm}>
        <input type="hidden" name="drinkId" value={drinkId} />
        <fieldset className={styles.starPicker}>
          <legend>Stars</legend>
          {[1, 2, 3, 4, 5].map((stars) => (
            <label key={stars} className={styles.star}>
              <input type="radio" name="stars" value={stars} defaultChecked={rating?.stars === stars} required />
              <span aria-hidden="true">★</span>
              <span className={styles.hiddenLabel}>{stars === 1 ? "1 star" : `${stars} stars`}</span>
            </label>
          ))}
        </fieldset>
        <label className={cards.field}>
          <span>Comment (optional, one line)</span>
          <input name="comment" maxLength={200} defaultValue={rating?.comment ?? ""} autoComplete="off" />
        </label>
        {/* REQ-34: separate from the stars, and optional. */}
        <fieldset className={styles.choices}>
          <legend>Buy again?</legend>
          <div className={styles.choiceRow}>
            {(
              [
                ["yes", "Yes", true],
                ["no", "No", false],
                ["", "Not saying", null],
              ] as const
            ).map(([value, label, answer]) => (
              <label key={label} className={styles.choice}>
                <input type="radio" name="buyAgain" value={value} defaultChecked={(rating?.buy_again ?? null) === answer} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" className={cards.primary} disabled={pending}>
          {pending ? "Saving…" : "Save rating"}
        </button>
        <Outcome state={state} />
      </form>
      {rating ? (
        <form action={clearAction}>
          <input type="hidden" name="drinkId" value={drinkId} />
          <button type="submit" className={cards.quiet} disabled={clearing}>
            {clearing ? "Clearing…" : "Clear my rating"}
          </button>
          <Outcome state={cleared} />
        </form>
      ) : null}
    </div>
  );
}

// Removing asks first: choosing Remove opens this question, and only Yes
// removes. Every rating of it goes too.
export function RemoveDrinkForm({ drink, onKeep }: { drink: Drink; onKeep: () => void }) {
  const [state, formAction, pending] = useActionState(removeDrink, initialState);
  return (
    <form action={formAction} className={cards.form}>
      <input type="hidden" name="id" value={drink.id} />
      <p className={cards.check}>Remove {drink.name}, with everyone&apos;s ratings of it?</p>
      <div className={cards.actions}>
        <button type="submit" className={cards.primary} disabled={pending}>
          {pending ? "Removing…" : "Yes, remove it"}
        </button>
        <button type="button" className={cards.quiet} onClick={onKeep}>
          Keep it
        </button>
      </div>
      <Outcome state={state} />
    </form>
  );
}
