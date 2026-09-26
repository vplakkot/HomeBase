import Link from "next/link";
import { buyAgainText, drinkLine, listDrinks, parseSort, ratingsFor, sortValue, starsText } from "../../lib/drinks/drinks";
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
  wanted = false,
}: {
  viewer: DrinksViewer;
  // REQ-36: the Want to try view instead of the main list.
  wanted?: boolean;
  q?: string;
  type?: string;
  sort?: string;
}) {
  const sort = parseSort(sortParam);
  const drinks = listDrinks(viewer.drinks, viewer.ratings, { query: q, type, sort, wanted });
  const here = wanted ? "/drinks/want-to-try" : "/drinks";
  const everything = viewer.drinks.filter((drink) => (drink.how === "want_to_try") === wanted).length;
  const filtered = q.trim() !== "" || type !== "";

  return (
    <DrinksScreen viewer={viewer} section={wanted ? "Want to try" : undefined} tools={<SearchBox query={q} here={here} />}>
      <ListControls type={type} sort={sortValue(sort)} people={wanted ? [] : viewer.people} />
      <section className={styles.section} aria-labelledby="drinks">
        <div className={styles.sectionHead}>
          <h2 id="drinks" className={styles.sectionTitle}>
            {filtered ? "Results" : wanted ? "Want to try" : "Our drinks"} <span className={styles.count}>· {drinks.length}</span>
          </h2>
        </div>
        {drinks.length === 0 ? (
          <p className={styles.empty}>
            {everything > 0
              ? "Nothing matches."
              : wanted
                ? "Nothing on the list. Add a drink and choose Want to try."
                : "Nothing recorded yet. Add a drink to start."}
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
                    {wanted ? null : (
                      <ul className={styles.ratings} aria-label="Ratings">
                        {ratingsFor(drink.id, viewer.people, viewer.ratings).map(({ person, rating }) => (
                          <li key={person.user_id}>
                            <span>{person.name}</span>{" "}
                            {rating ? (
                              <>
                                <span className={styles.stars} aria-label={`${rating.stars} of 5 stars`}>
                                  {starsText(rating.stars)}
                                </span>
                                {rating.buy_again !== null ? (
                                  <span className={styles.buyAgain}> · {buyAgainText(rating.buy_again)}</span>
                                ) : null}
                              </>
                            ) : (
                              <span className={styles.unrated}>not rated</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
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
