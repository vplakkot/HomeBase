"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useState } from "react";
import cards from "../../components/cards.module.css";
import { HOW_NAMES, HOWS, vintageText, type Drink, type DrinkFields, type How, type Rating } from "../../lib/drinks/drinks";
import { BOTTLE_SIZES, COUNTRIES, DRINK_TYPES, GRAPES, METHODS, REGIONS, SWEETNESS, TYPE_NAMES } from "../../lib/drinks/lists";
import { addDrink, clearRating, rateDrink, removeDrink, setPhotos, updateDrink, type FormState } from "./actions";
import { appendShots, LabelPhotos, type Shots } from "./photos";
import styles from "./drinks.module.css";

const initialState: FormState = {};

function Outcome({ state }: { state: FormState }) {
  return state?.error ? (
    <p role="alert" className={cards.error}>
      {state.error}
    </p>
  ) : null;
}

function useOnSaved(state: FormState, onSaved?: () => void) {
  useEffect(() => {
    if (state?.saved) onSaved?.();
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

// REQ-27: a field read with little confidence says so, to be checked.
function Unsure() {
  return <em className={styles.unsure}> · check this</em>;
}

function Field({
  label,
  name,
  value,
  list,
  placeholder,
  inputMode,
  type = "text",
  unsure = false,
}: {
  label: string;
  name: string;
  value: string;
  list?: string;
  placeholder?: string;
  inputMode?: "numeric" | "decimal";
  type?: string;
  unsure?: boolean;
}) {
  return (
    <label className={cards.field}>
      <span>
        {label}
        {unsure ? <Unsure /> : null}
      </span>
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
// we got it. The scan's review screen (REQ-28) is this same form, filled
// in with what was read (`initial`, with `unsure` fields marked) and
// sending the label photos (`shots`) with it; Cancel there saves nothing.
// With `drink`, it changes that drink.
export function DrinkForm({
  drink,
  initial,
  unsure = [],
  shots,
  cancelHref,
  onIdentity,
}: {
  drink?: Drink;
  initial?: Partial<DrinkFields>;
  unsure?: readonly string[];
  shots?: Shots;
  cancelHref?: string;
  // Told when the name, producer or vintage is changed (REQ-33: the shop
  // check looks again).
  onIdentity?: (fields: { name: string; producer: string; vintage: string }) => void;
}) {
  const [state, formAction, pending] = useActionState(drink ? updateDrink : addDrink, initialState);
  const v: Partial<DrinkFields> = drink ?? initial ?? {};
  const [grapes, setGrapes] = useState<string[]>(v.grapes && v.grapes.length > 0 ? [...v.grapes] : [""]);
  const [type, setType] = useState<string>(v.type ?? "");
  const sparkling = type === "sparkling";
  const check = (name: string) => unsure.includes(name);
  // With photos, the form's data is sent by hand so they can go with it.
  const submitWithShots = (event: React.FormEvent<HTMLFormElement>) => {
    if (!shots) return;
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    appendShots(data, shots);
    startTransition(() => formAction(data));
  };
  return (
    <form
      action={formAction}
      onSubmit={submitWithShots}
      onChange={(event) => {
        const target = event.target as unknown as HTMLInputElement;
        if (!onIdentity || !["name", "producer", "vintage"].includes(target.name)) return;
        const data = new FormData(event.currentTarget);
        const text = (name: string) => String(data.get(name) ?? "");
        onIdentity({ name: text("name"), producer: text("producer"), vintage: text("vintage") });
      }}
      className={`${cards.form} ${styles.drinkForm}`}
    >
      {drink ? <input type="hidden" name="id" value={drink.id} /> : null}
      <Suggestions />
      <label className={cards.field}>
        <span>Name{check("name") ? <Unsure /> : null}</span>
        <input name="name" required defaultValue={v.name ?? ""} placeholder="Wine name or cuvée" autoComplete="off" />
      </label>
      <HowWeGotIt drink={drink} />
      <Field label="Producer (optional)" name="producer" value={v.producer ?? ""} unsure={check("producer")} />
      <div className={styles.pairFields}>
        <label className={cards.field}>
          <span>Type (optional){check("type") ? <Unsure /> : null}</span>
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
          value={vintageText({ vintage: v.vintage ?? null, non_vintage: v.non_vintage ?? false }) ?? ""}
          placeholder="2019 or NV"
          unsure={check("vintage")}
        />
      </div>
      <fieldset className={styles.grapes}>
        <legend>Grapes (optional){check("grapes") ? <Unsure /> : null}</legend>
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
        <Field label="Region (optional)" name="region" value={v.region ?? ""} list="region-list" unsure={check("region")} />
        <Field label="Country (optional)" name="country" value={v.country ?? ""} list="country-list" unsure={check("country")} />
      </div>
      <div className={styles.pairFields}>
        <Field
          label="Alcohol % (optional)"
          name="abv"
          value={v.abv === null || v.abv === undefined ? "" : String(v.abv)}
          placeholder="13.5"
          inputMode="decimal"
          unsure={check("abv")}
        />
        <label className={cards.field}>
          <span>Bottle size (optional){check("bottle_ml") ? <Unsure /> : null}</span>
          <select name="bottle_ml" defaultValue={v.bottle_ml ? String(v.bottle_ml) : ""}>
            <option value="">Not set</option>
            {BOTTLE_SIZES.map((size) => (
              <option key={size.ml} value={size.ml}>
                {size.name}
              </option>
            ))}
            {v.bottle_ml && !BOTTLE_SIZES.some((size) => size.ml === v.bottle_ml) ? (
              <option value={v.bottle_ml}>{v.bottle_ml} ml</option>
            ) : null}
          </select>
        </label>
      </div>
      {/* REQ-27: sparkling wines also have a sweetness, a method and a
          disgorgement date. Hidden for other types, and not sent. */}
      {sparkling ? (
        <div className={styles.pairFields}>
          <Field label="Sweetness (optional)" name="sweetness" value={v.sweetness ?? ""} list="sweetness-list" unsure={check("sweetness")} />
          <Field label="Method (optional)" name="method" value={v.method ?? ""} list="method-list" unsure={check("method")} />
          <Field label="Disgorged (optional)" name="disgorged_on" value={v.disgorged_on ?? ""} type="date" unsure={check("disgorged_on")} />
        </div>
      ) : null}
      <div className={cards.actions}>
        <button type="submit" className={cards.primary} disabled={pending}>
          {pending ? "Saving…" : drink ? "Save changes" : shots ? "Save" : "Add the drink"}
        </button>
        {cancelHref ? (
          <Link href={cancelHref} className={cards.quiet}>
            Cancel
          </Link>
        ) : null}
      </div>
      <Outcome state={state} />
    </form>
  );
}

// REQ-32: photos for a drink saved without them, or new ones for a bad
// photo; the drink's details stay as they are.
export function PhotosForm({ drinkId, onSaved }: { drinkId: string; onSaved: () => void }) {
  const [state, formAction, pending] = useActionState(setPhotos, initialState);
  useOnSaved(state, onSaved);
  const save = (shots: Shots) => {
    const data = new FormData();
    data.append("id", drinkId);
    appendShots(data, shots);
    startTransition(() => formAction(data));
  };
  return (
    <div className={cards.form}>
      {pending ? <p className={styles.unrated}>Saving the photos…</p> : <LabelPhotos onDone={save} />}
      <Outcome state={state} />
    </div>
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
