import { ratingsFor, starsText, vintageText, type Drink } from "../../lib/drinks/drinks";
import { BOTTLE_SIZES, TYPE_NAMES } from "../../lib/drinks/lists";
import { HOUSEHOLD_TIME_ZONE } from "../../lib/finances/budget-year";
import { DrinksScreen, type DrinksViewer } from "./frame";
import { ManageDrink, RateButton } from "./sheets";
import styles from "./drinks.module.css";

const changedOn = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: HOUSEHOLD_TIME_ZONE });

// One drink (REQ-29, REQ-37): its details, then every household member's
// rating and comment by name, "Not rated yet" for anyone who hasn't. You
// can rate it or change your own rating any time; nobody else's.
export function DrinkScreen({ viewer, drink }: { viewer: DrinksViewer; drink: Drink }) {
  const ratings = ratingsFor(drink.id, viewer.people, viewer.ratings);
  const mine = ratings.find(({ person }) => person.user_id === viewer.userId)?.rating ?? null;
  const size = drink.bottle_ml
    ? (BOTTLE_SIZES.find((row) => row.ml === drink.bottle_ml)?.name ?? `${drink.bottle_ml} ml`)
    : null;
  const details: [string, string | null][] = [
    ["Producer", drink.producer],
    ["Type", drink.type ? TYPE_NAMES[drink.type] : null],
    ["Vintage", vintageText(drink)],
    ["Grapes", drink.grapes.length > 0 ? drink.grapes.join(", ") : null],
    ["Region", drink.region],
    ["Country", drink.country],
    ["Alcohol", drink.abv === null ? null : `${drink.abv}%`],
    ["Bottle", size],
    ["Sweetness", drink.sweetness],
    ["Method", drink.method],
    ["Disgorged", drink.disgorged_on],
  ];
  const shown = details.filter((row): row is [string, string] => row[1] !== null);

  return (
    <DrinksScreen viewer={viewer} crumb={drink.name}>
      <div className={styles.fileHead}>
        <h2 className={styles.title}>{drink.name}</h2>
        <div className={styles.fileButtons}>
          <RateButton drinkId={drink.id} rating={mine} />
          <ManageDrink drink={drink} />
        </div>
      </div>
      <div className={styles.pair}>
        <section className={styles.card} aria-labelledby="ratings">
          <h3 id="ratings" className={styles.cardLabel}>
            Ratings
          </h3>
          <ul className={styles.lines}>
            {ratings.map(({ person, rating }) => (
              <li key={person.user_id} className={styles.rating}>
                <span className={styles.who}>{person.name}</span>
                {rating ? (
                  <>
                    <span className={styles.stars} aria-label={`${rating.stars} of 5 stars`}>
                      {starsText(rating.stars)}
                    </span>
                    {rating.comment ? <span className={styles.comment}>{rating.comment}</span> : null}
                    <span className={styles.changed}>Changed {changedOn.format(new Date(rating.updated_at))}</span>
                  </>
                ) : (
                  <span className={styles.unrated}>Not rated yet</span>
                )}
              </li>
            ))}
          </ul>
        </section>
        <section className={styles.card} aria-labelledby="details">
          <h3 id="details" className={styles.cardLabel}>
            Details
          </h3>
          {shown.length === 0 ? (
            <p className={styles.unrated}>Only a name so far. Edit to add more.</p>
          ) : (
            <dl className={styles.details}>
              {shown.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </div>
    </DrinksScreen>
  );
}
