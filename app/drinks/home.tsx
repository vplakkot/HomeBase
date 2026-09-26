import Link from "next/link";
import { drinkLine, listDrinks, parseSort, ratingsFor, sortValue, starsText } from "../../lib/drinks/drinks";
import { TYPE_NAMES } from "../../lib/drinks/lists";
import { DrinksScreen, type DrinksViewer } from "./frame";
import { ListControls, SearchBox } from "./controls";
import styles from "./drinks.module.css";

// Drinks' home (REQ-30): every drink we've recorded, newest first, each
// with every household member's rating or "not rated". Search, a type
// filter and a sort sit in the address (?q, ?type, ?sort), so the back
// button and a shared link keep them.
export function DrinksHome({
  viewer,
  q = "",
  type = "",
  sort: sortParam,
}: {
  viewer: DrinksViewer;
  q?: string;
  type?: string;
  sort?: string;
}) {
  const sort = parseSort(sortParam);
  const drinks = listDrinks(viewer.drinks, viewer.ratings, { query: q, type, sort });
  const filtered = q.trim() !== "" || type !== "";

  return (
    <DrinksScreen viewer={viewer} tools={<SearchBox query={q} />}>
      <ListControls type={type} sort={sortValue(sort)} people={viewer.people} />
      <section className={styles.section} aria-labelledby="drinks">
        <div className={styles.sectionHead}>
          <h2 id="drinks" className={styles.sectionTitle}>
            {filtered ? "Results" : "Our drinks"} <span className={styles.count}>· {drinks.length}</span>
          </h2>
        </div>
        {drinks.length === 0 ? (
          <p className={styles.empty}>
            {viewer.drinks.length === 0 ? "Nothing recorded yet. Add a drink to start." : "Nothing matches."}
          </p>
        ) : (
          <ul className={styles.grid}>
            {drinks.map((drink) => {
              const line = drinkLine(drink, (t) => TYPE_NAMES[t]);
              return (
                <li key={drink.id}>
                  <Link href={`/drinks/${drink.id}`} className={styles.linkCard}>
                    <span className={styles.cardTitle}>{drink.name}</span>
                    {line ? <span className={styles.cardDetail}>{line}</span> : null}
                    <ul className={styles.ratings} aria-label="Ratings">
                      {ratingsFor(drink.id, viewer.people, viewer.ratings).map(({ person, rating }) => (
                        <li key={person.user_id}>
                          <span>{person.name}</span>{" "}
                          {rating ? (
                            <span className={styles.stars} aria-label={`${rating.stars} of 5 stars`}>
                              {starsText(rating.stars)}
                            </span>
                          ) : (
                            <span className={styles.unrated}>not rated</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </DrinksScreen>
  );
}
