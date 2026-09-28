import Link from "next/link";
import { ButtonLink } from "../../components/button";
import type { Place } from "../../lib/restaurants/places";
import type { Restaurant } from "../../lib/restaurants/restaurants";
import { RestaurantsScreen, type RestaurantsViewer } from "./frame";
import { PlacePhoto } from "./place-photo";
import styles from "./restaurants.module.css";
import { GoAgain } from "./tried";

// A saved place and what Google said about it, or null where it couldn't.
export type Shown = { row: Restaurant; place: Place | null };

// Want to try (REQ-129): every place not yet tried as a tile with Google's
// photo, name, cuisine and neighbourhood, newest first. Above it, "Go
// again?" for each tried place the viewer hasn't answered for (REQ-133);
// it stays until they do.
export function WantToTry({ viewer, toTry, waiting }: { viewer: RestaurantsViewer; toTry: readonly Shown[]; waiting: readonly Shown[] }) {
  return (
    <RestaurantsScreen viewer={viewer}>
      {waiting.length > 0 ? (
        <section className={styles.section} aria-labelledby="go-again">
          <div className={styles.sectionHead}>
            <h2 id="go-again" className={styles.sectionTitle}>
              Go again?
            </h2>
          </div>
          <ul className={styles.foundList}>
            {waiting.map(({ row, place }) => {
              const name = place?.name ?? "This place";
              return (
                <li key={row.id} className={styles.found}>
                  <PlacePhoto photo={place?.photo ?? null} className={styles.foundPhoto} />
                  <div className={styles.foundText}>
                    <Link href={`/restaurants/${row.id}`} className={styles.cardTitle}>
                      {name}
                    </Link>
                    <GoAgain id={row.id} answer={null} label={`Go again to ${name}?`} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      <section className={styles.section} aria-labelledby="want-to-try">
        <div className={styles.sectionHead}>
          <h2 id="want-to-try" className={styles.sectionTitle}>
            Want to try <span className={styles.count}>· {toTry.length}</span>
          </h2>
        </div>
        {toTry.length === 0 ? (
          <div className={styles.emptyState}>
            <p className={styles.empty}>No places yet. Paste a Google Maps, Apple Maps or OpenTable link to save one.</p>
            <ButtonLink href="/restaurants/new">Add place</ButtonLink>
          </div>
        ) : (
          <ul className={styles.tiles}>
            {toTry.map(({ row, place }) => {
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
