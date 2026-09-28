"use client";

import Link from "next/link";
import { useActionState } from "react";
import cards from "../../components/cards.module.css";
import { ALREADY_SAVED, ALREADY_TRIED } from "../../lib/restaurants/restaurants";
import { addBookingLink, addPlace, lookUpPlace, type FormState, type FoundPlace, type LookupState } from "./actions";
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
// or where it already is if we've saved it. From an OpenTable link, Add
// brings the booking link along, and a place saved without one is offered
// it instead (REQ-131).
function FoundCard({ place, bookingUrl }: { place: FoundPlace; bookingUrl?: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(addPlace, {});
  const [linkState, linkAction, linking] = useActionState<FormState, FormData>(addBookingLink, {});
  return (
    <li className={styles.found}>
      <PlacePhoto photo={place.photo} className={styles.foundPhoto} />
      <div className={styles.foundText}>
        <span className={styles.cardTitle}>{place.name}</span>
        {place.address ? <span className={styles.cardDetail}>{place.address}</span> : null}
        {place.savedId ? (
          <p className={styles.notice}>
            {place.savedTried ? ALREADY_TRIED : ALREADY_SAVED}{" "}
            <Link href={`/restaurants/${place.savedId}`} className={styles.textLink}>
              Open it
            </Link>
          </p>
        ) : null}
        {place.savedId && bookingUrl && !place.savedBooking ? (
          <form action={linkAction}>
            <input type="hidden" name="id" value={place.savedId} />
            <input type="hidden" name="bookingUrl" value={bookingUrl} />
            <button type="submit" className={cards.primary} disabled={linking}>
              {linking ? "Adding…" : "Add the OpenTable link to it"}
            </button>
          </form>
        ) : null}
        {place.savedId ? null : (
          <form action={formAction}>
            <input type="hidden" name="placeId" value={place.placeId} />
            {bookingUrl ? <input type="hidden" name="bookingUrl" value={bookingUrl} /> : null}
            <button type="submit" className={cards.primary} disabled={pending}>
              {pending ? "Adding…" : "Add to Want to try"}
            </button>
          </form>
        )}
        <Problem state={state} />
        <Problem state={linkState} />
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
          <span>Google Maps, Apple Maps or OpenTable link</span>
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
              <FoundCard key={place.placeId} place={place} bookingUrl={state.bookingUrl} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
