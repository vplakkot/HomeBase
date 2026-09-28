import { buttonClass } from "../../components/button";
import { HOUSEHOLD_TIME_ZONE } from "../../lib/finances/budget-year";
import type { Place } from "../../lib/restaurants/places";
import type { Restaurant } from "../../lib/restaurants/restaurants";
import { RestaurantsScreen, type RestaurantsViewer } from "./frame";
import { PlacePhoto } from "./place-photo";
import { RemovePlace } from "./remove";
import styles from "./restaurants.module.css";
import { BookingLink, GoAgain, MarkTried, UndoTried } from "./tried";

const addedOn = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: HOUSEHOLD_TIME_ZONE });

// "example.com" for https://www.example.com/menu, or the link as given.
function siteName(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return link;
  }
}

// One place (REQ-129): its photo, address, hours and website from Google,
// and who of us added it and when. Book and Open in Google Maps (REQ-132);
// Mark as tried, or once tried, the date, each person's go-again and Undo
// (REQ-133). `place` is null when Google couldn't say; the page still
// offers Remove and everything that's ours.
export function PlaceScreen({ viewer, row, place }: { viewer: RestaurantsViewer; row: Restaurant; place: Place | null }) {
  const name = place?.name ?? "This place";
  const by = viewer.people.find((person) => person.user_id === row.added_by)?.name ?? "Someone";
  const line = place ? [place.cuisine, place.neighborhood].filter(Boolean).join(" · ") : "";
  const answers = viewer.answers.filter((answer) => answer.restaurant_id === row.id);
  const answerOf = (userId: string) => answers.find((answer) => answer.user_id === userId)?.go_again ?? null;
  // The viewer first: theirs is the one they can change.
  const people = [...viewer.people].sort((a, b) => Number(b.user_id === viewer.userId) - Number(a.user_id === viewer.userId));

  return (
    <RestaurantsScreen
      viewer={viewer}
      section={row.tried_on ? "Been to" : "Want to try"}
      crumb={name}
      beenTo={row.tried_on !== null}
      actions={<RemovePlace id={row.id} name={name} />}
    >
      <article className={styles.detail}>
        <PlacePhoto photo={place?.photo ?? null} width={800} className={styles.hero} />
        <div className={styles.detailText}>
          <h2 className={styles.title}>{name}</h2>
          {line ? <p className={styles.cardDetail}>{line}</p> : null}
          {place ? null : <p className={styles.empty}>Couldn&apos;t load this place from Google. Try again in a moment.</p>}
          <div className={styles.placeActions}>
            {row.booking_url ? (
              <a href={row.booking_url} className={buttonClass} target="_blank" rel="noreferrer">
                Book
              </a>
            ) : null}
            {place?.mapsUrl ? (
              <a href={place.mapsUrl} className={buttonClass} target="_blank" rel="noreferrer">
                Open in Google Maps
              </a>
            ) : null}
            {row.tried_on ? null : <MarkTried id={row.id} />}
          </div>
          {row.tried_on ? (
            <section className={styles.tried} aria-labelledby="go-again">
              <h3 id="go-again" className={styles.sectionTitle}>
                Go again?
              </h3>
              <ul className={styles.answers}>
                {people.map((person) => {
                  const answer = answerOf(person.user_id);
                  return (
                    <li key={person.user_id}>
                      <span className={styles.cardTitle}>{person.user_id === viewer.userId ? "You" : person.name}</span>
                      {person.user_id === viewer.userId ? (
                        <GoAgain id={row.id} answer={answer} label="Your answer" />
                      ) : (
                        <span className={styles.cardDetail}>{answer === null ? "Waiting" : answer ? "Yes" : "No"}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
          <dl className={styles.details}>
            {place?.address ? (
              <div>
                <dt>Address</dt>
                <dd>{place.address}</dd>
              </div>
            ) : null}
            {place && place.hours.length > 0 ? (
              <div>
                <dt>Hours</dt>
                <dd>
                  <ul className={styles.hours}>
                    {place.hours.map((day) => (
                      <li key={day}>{day}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}
            {place?.website ? (
              <div>
                <dt>Website</dt>
                <dd>
                  <a href={place.website} className={styles.textLink} target="_blank" rel="noreferrer">
                    {siteName(place.website)}
                  </a>
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Booking</dt>
              <dd className={styles.booking}>
                {row.booking_url ? (
                  <a href={row.booking_url} className={styles.textLink} target="_blank" rel="noreferrer">
                    {siteName(row.booking_url)}
                  </a>
                ) : null}
                <BookingLink id={row.id} current={row.booking_url} />
              </dd>
            </div>
            <div>
              <dt>Added</dt>
              <dd>
                {by}, {addedOn.format(new Date(row.created_at))}
              </dd>
            </div>
            {row.tried_on ? (
              <div>
                <dt>Tried</dt>
                <dd className={styles.booking}>
                  {addedOn.format(new Date(`${row.tried_on}T12:00:00Z`))}
                  <UndoTried id={row.id} name={name} />
                </dd>
              </div>
            ) : null}
          </dl>
          <p className={styles.source}>From Google Maps</p>
        </div>
      </article>
    </RestaurantsScreen>
  );
}
