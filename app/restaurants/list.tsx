import Link from "next/link";
import { ButtonLink } from "../../components/button";
import type { Place } from "../../lib/restaurants/places";
import { RestaurantsScreen, type RestaurantsViewer } from "./frame";
import { PlacePhoto } from "./place-photo";
import styles from "./restaurants.module.css";

// Want to try (REQ-129): every saved place as a tile with Google's photo,
// name, cuisine and neighbourhood, newest first. `details` is what Google
// said about each row, in the same order, or null where it couldn't say.
export function WantToTry({ viewer, details }: { viewer: RestaurantsViewer; details: readonly (Place | null)[] }) {
  return (
    <RestaurantsScreen viewer={viewer}>
      <section className={styles.section} aria-labelledby="want-to-try">
        <div className={styles.sectionHead}>
          <h2 id="want-to-try" className={styles.sectionTitle}>
            Want to try <span className={styles.count}>· {viewer.restaurants.length}</span>
          </h2>
        </div>
        {viewer.restaurants.length === 0 ? (
          <div className={styles.emptyState}>
            <p className={styles.empty}>No places yet. Paste a Google Maps or Apple Maps link to save one.</p>
            <ButtonLink href="/restaurants/new">Add place</ButtonLink>
          </div>
        ) : (
          <ul className={styles.tiles}>
            {viewer.restaurants.map((row, index) => {
              const place = details[index];
              const line = place ? [place.cuisine, place.neighborhood].filter(Boolean).join(" · ") : "";
              return (
                <li key={row.id}>
                  <Link href={`/restaurants/${row.id}`} className={styles.tile}>
                    <PlacePhoto photo={place?.photo ?? null} />
                    <span className={styles.tileText}>
                      <span className={styles.cardTitle}>{place?.name ?? "Couldn't load from Google"}</span>
                      {line ? <span className={styles.cardDetail}>{line}</span> : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </RestaurantsScreen>
  );
}
