import { OVERVIEW } from "../../components/module-frame";
import Link from "next/link";
import { displayName, drinksSummary, ratingsFor, recentDrinks, starsText, summaryText, vintageText } from "../../lib/drinks/drinks";
import { thumbPath } from "../../lib/drinks/photos";
import { SearchBox } from "./controls";
import { DrinksScreen, type DrinksViewer } from "./frame";
import styles from "./drinks.module.css";

// Drinks' Overview (REQ-120): where we stand at a glance, and the last
// three drinks added, or Recent scans saying nothing's recorded yet (the
// header's Scan and Choose a photo aren't repeated). The full list is the
// Wines section (REQ-121); the header's search goes there.
export function DrinksOverview({ viewer }: { viewer: DrinksViewer }) {
  const recent = recentDrinks(viewer.drinks);
  return (
    <DrinksScreen viewer={viewer} section={OVERVIEW} tools={<SearchBox query="" here="/drinks/wines" />}>
      {viewer.drinks.length > 0 ? (
        <p className={styles.summary}>{summaryText(drinksSummary(viewer.drinks, viewer.ratings))}</p>
      ) : null}
      <section className={styles.section} aria-labelledby="recent">
        <div className={styles.sectionHead}>
          <h2 id="recent" className={styles.sectionTitle}>
            Recent scans
          </h2>
        </div>
        {recent.length === 0 ? (
          <p className={styles.empty}>Nothing recorded yet.</p>
        ) : (
          <ul className={styles.grid}>
            {recent.map((drink) => {
              const thumb = drink.front_label ? viewer.thumbs.get(thumbPath(drink.front_label)) : undefined;
              const vintage = vintageText(drink);
              const stars = ratingsFor(drink.id, viewer.people, viewer.ratings).flatMap(({ person, rating }) =>
                rating ? [{ name: person.name, stars: rating.stars }] : [],
              );
              return (
                <li key={drink.id}>
                  <Link href={`/drinks/${drink.id}`} className={`${styles.linkCard} ${thumb ? styles.withThumb : ""}`}>
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a private, short-lived link
                      <img src={thumb} alt="" className={styles.thumb} />
                    ) : null}
                    <span className={styles.cardTitle}>{displayName(drink)}</span>
                    {vintage ? <span className={styles.cardDetail}>{vintage}</span> : null}
                    {stars.length > 0 ? (
                      <ul className={styles.ratings} aria-label="Ratings">
                        {stars.map((row) => (
                          <li key={row.name}>
                            <span>{row.name}</span>{" "}
                            <span className={styles.stars} aria-label={`${row.stars} of 5 stars`}>
                              {starsText(row.stars)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
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
