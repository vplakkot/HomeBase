import Link from "next/link";
import type { ReactNode } from "react";
import { ButtonLink } from "../../components/button";
import { applyFilter, filterOptions, type PlaceFilter } from "../../lib/restaurants/filter";
import type { Place } from "../../lib/restaurants/places";
import type { Restaurant } from "../../lib/restaurants/restaurants";
import { PlaceFilters } from "./filters";
import { RestaurantsScreen, type RestaurantsViewer } from "./frame";
import { PlacePhoto } from "./place-photo";
import styles from "./restaurants.module.css";
import { GoAgain } from "./tried";

// A saved place and what Google said about it, or null where it couldn't.
export type Shown = { row: Restaurant; place: Place | null };

// Want to try (REQ-129): every place not yet tried as a tile with Google's
// photo, name, cuisine and neighbourhood, newest first. Above it, "Go
// again?" for each tried place the viewer hasn't answered for (REQ-133);
// it stays until they do. The filter (REQ-135) narrows Want to try only.
export function WantToTry({
  viewer,
  toTry,
  waiting,
  filter,
}: {
  viewer: RestaurantsViewer;
  toTry: readonly Shown[];
  waiting: readonly Shown[];
  filter: PlaceFilter;
}) {
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
            Want to try <span className={styles.count}>· {shownCount(toTry, filter)}</span>
          </h2>
        </div>
        {toTry.length === 0 ? (
          <div className={styles.emptyState}>
            <p className={styles.empty}>No places yet. Paste a Google Maps, Apple Maps or OpenTable link to save one.</p>
            <ButtonLink href="/restaurants/new">Add place</ButtonLink>
          </div>
        ) : (
          <FilteredTiles here="/restaurants" all={toTry} filter={filter} />
        )}
      </section>
    </RestaurantsScreen>
  );
}

const shownCount = (all: readonly Shown[], filter: PlaceFilter) => applyFilter(all, filter).length;

// The filter over a page's places (REQ-135), then the ones that match as
// tiles: Google's photo, name, cuisine and neighbourhood (REQ-129), and
// anything else the page adds under them (`extra`).
function FilteredTiles({
  here,
  all,
  filter,
  extra,
}: {
  here: string;
  all: readonly Shown[];
  filter: PlaceFilter;
  extra?: (row: Restaurant) => ReactNode;
}) {
  const { areas, cuisines } = filterOptions(all);
  const shown = applyFilter(all, filter);
  return (
    <>
      <PlaceFilters here={here} filter={filter} areas={areas} cuisines={cuisines} />
      {shown.length === 0 ? (
        <p className={styles.empty}>No places match. Clear the filter to see them all.</p>
      ) : (
        <ul className={styles.tiles}>
          {shown.map(({ row, place }) => {
            const line = place ? [place.cuisine, place.neighborhood].filter(Boolean).join(" · ") : "";
            return (
              <li key={row.id}>
                <Link href={`/restaurants/${row.id}`} className={styles.tile}>
                  <PlacePhoto photo={place?.photo ?? null} />
                  <span className={styles.tileText}>
                    <span className={styles.cardTitle}>{place?.name ?? "Couldn't load from Google"}</span>
                    {line ? <span className={styles.cardDetail}>{line}</span> : null}
                    {extra?.(row)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

// Been to (REQ-134): every tried place as a tile, most recently tried
// first, each with both of our go-again answers. The viewer is "You".
export function BeenTo({ viewer, tried, filter }: { viewer: RestaurantsViewer; tried: readonly Shown[]; filter: PlaceFilter }) {
  const people = [...viewer.people].sort((a, b) => Number(b.user_id === viewer.userId) - Number(a.user_id === viewer.userId));
  const answers = (row: Restaurant) => (
    <span className={styles.tileAnswers}>
      {people.map((person) => {
        const given = viewer.answers.find((answer) => answer.restaurant_id === row.id && answer.user_id === person.user_id);
        const text = given === undefined ? "Waiting" : given.go_again ? "Yes" : "No";
        return (
          <span key={person.user_id}>
            {person.user_id === viewer.userId ? "You" : person.name}: {text}
          </span>
        );
      })}
    </span>
  );
  return (
    <RestaurantsScreen viewer={viewer} section="Been to">
      <section className={styles.section} aria-labelledby="been-to">
        <div className={styles.sectionHead}>
          <h2 id="been-to" className={styles.sectionTitle}>
            Been to <span className={styles.count}>· {shownCount(tried, filter)}</span>
          </h2>
        </div>
        {tried.length === 0 ? (
          <p className={styles.empty}>Nowhere yet. Open a place on Want to try and mark it as tried.</p>
        ) : (
          <FilteredTiles here="/restaurants/been-to" all={tried} filter={filter} extra={answers} />
        )}
      </section>
    </RestaurantsScreen>
  );
}
