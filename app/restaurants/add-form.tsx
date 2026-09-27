"use client";

import Link from "next/link";
import { useActionState } from "react";
import cards from "../../components/cards.module.css";
import { ALREADY_SAVED } from "../../lib/restaurants/restaurants";
import { addPlace, lookUpPlace, type FormState, type FoundPlace, type LookupState } from "./actions";
import { PlacePhoto } from "./place-photo";
import styles from "./restaurants.module.css";

function Problem({ state }: { state: FormState }) {
  return state.error ? (
    <p role="alert" className={cards.error}>
      {state.error}
    </p>
  ) : null;
}

// One place Google found: its photo, name and address, and Add (REQ-90),
// or where it already is if we've saved it.
function FoundCard({ place }: { place: FoundPlace }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(addPlace, {});
  return (
    <li className={styles.found}>
      <PlacePhoto photo={place.photo} className={styles.foundPhoto} />
      <div className={styles.foundText}>
        <span className={styles.cardTitle}>{place.name}</span>
        {place.address ? <span className={styles.cardDetail}>{place.address}</span> : null}
        {place.savedId ? (
          <p className={styles.notice}>
            {ALREADY_SAVED}{" "}
            <Link href={`/restaurants/${place.savedId}`} className={styles.textLink}>
              Open it
            </Link>
          </p>
        ) : (
          <form action={formAction}>
            <input type="hidden" name="placeId" value={place.placeId} />
            <button type="submit" className={cards.primary} disabled={pending}>
              {pending ? "Adding…" : "Add to Want to try"}
            </button>
          </form>
        )}
        <Problem state={state} />
      </div>
    </li>
  );
}

export function AddPlaceForm() {
  const [state, formAction, pending] = useActionState<LookupState, FormData>(lookUpPlace, {});
  return (
    <div className={styles.addCard}>
      <form action={formAction} className={cards.form}>
        <label className={cards.field}>
          <span>Google Maps or Apple Maps link</span>
          <input name="link" type="url" inputMode="url" required autoComplete="off" placeholder="https://maps.app.goo.gl/…" />
        </label>
        <div className={cards.actions}>
          <button type="submit" className={cards.primary} disabled={pending}>
            {pending ? "Looking…" : "Find place"}
          </button>
        </div>
        <Problem state={state} />
      </form>
      {state.places && state.places.length > 0 ? (
        <section aria-labelledby="found">
          <h2 id="found" className={styles.sectionTitle}>
            {state.choose ? "Which one?" : "Is this it?"}
          </h2>
          <ul className={styles.foundList}>
            {state.places.map((place) => (
              <FoundCard key={place.placeId} place={place} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
