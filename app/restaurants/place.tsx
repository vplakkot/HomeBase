import { HOUSEHOLD_TIME_ZONE } from "../../lib/finances/budget-year";
import type { Place } from "../../lib/restaurants/places";
import type { Restaurant } from "../../lib/restaurants/restaurants";
import { RestaurantsScreen, type RestaurantsViewer } from "./frame";
import { PlacePhoto } from "./place-photo";
import { RemovePlace } from "./remove";
import styles from "./restaurants.module.css";

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
// and who of us added it and when. Book and Mark as tried come with their
// own requirements (REQ-132, REQ-133). `place` is null when Google
// couldn't say; the page still offers Remove.
export function PlaceScreen({ viewer, row, place }: { viewer: RestaurantsViewer; row: Restaurant; place: Place | null }) {
  const name = place?.name ?? "This place";
  const by = viewer.people.find((person) => person.user_id === row.added_by)?.name ?? "Someone";
  const line = place ? [place.cuisine, place.neighborhood].filter(Boolean).join(" · ") : "";

  return (
    <RestaurantsScreen viewer={viewer} section="Want to try" crumb={name} actions={<RemovePlace id={row.id} name={name} />}>
      <article className={styles.detail}>
        <PlacePhoto photo={place?.photo ?? null} width={800} className={styles.hero} />
        <div className={styles.detailText}>
          <h2 className={styles.title}>{name}</h2>
          {line ? <p className={styles.cardDetail}>{line}</p> : null}
          {place ? null : <p className={styles.empty}>Couldn&apos;t load this place from Google. Try again in a moment.</p>}
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
              <dt>Added</dt>
              <dd>
                {by}, {addedOn.format(new Date(row.created_at))}
              </dd>
            </div>
          </dl>
          <p className={styles.source}>From Google Maps</p>
        </div>
      </article>
    </RestaurantsScreen>
  );
}
