import { buyAgainText, howText, ratingsFor, starsText, vintageText, type Drink } from "../../lib/drinks/drinks";
import { BOTTLE_SIZES, TYPE_NAMES } from "../../lib/drinks/lists";
import { HOUSEHOLD_TIME_ZONE } from "../../lib/finances/budget-year";
import { DrinksScreen, type DrinksViewer } from "./frame";
import { ManageDrink, RateButton } from "./sheets";
import styles from "./drinks.module.css";

const changedOn = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: HOUSEHOLD_TIME_ZONE });

// One drink (REQ-29, REQ-37): its details, then every household member's
// rating and comment by name, "Not rated yet" for anyone who hasn't. You
// can rate it or change your own rating any time; nobody else's.
export function DrinkScreen({
  viewer,
  drink,
  links,
}: {
  viewer: DrinksViewer;
  drink: Drink;
  // The label photos' private links, by path (REQ-32).
  links: ReadonlyMap<string, string>;
}) {
  const ratings = ratingsFor(drink.id, viewer.people, viewer.ratings);
  const mine = ratings.find(({ person }) => person.user_id === viewer.userId)?.rating ?? null;
  const size = drink.bottle_ml
    ? (BOTTLE_SIZES.find((row) => row.ml === drink.bottle_ml)?.name ?? `${drink.bottle_ml} ml`)
    : null;
  const untried = drink.how === "want_to_try";
  const labels = [drink.front_label, drink.back_label].filter((path): path is string => !!path);
  const details: [string, string | null][] = [
    ["How we got it", howText(drink)],
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
          {/* REQ-36: rated once we've had it, not while it's only a wish. */}
          {untried ? null : <RateButton drinkId={drink.id} rating={mine} />}
          <ManageDrink drink={drink} hasPhotos={labels.length > 0} />
        </div>
      </div>
      {labels.length > 0 ? (
        <section className={styles.labels} aria-label="Label photos">
          {labels.map((path, index) =>
            links.get(path) ? (
              // eslint-disable-next-line @next/next/no-img-element -- a private, short-lived link
              <img key={path} src={links.get(path)} alt={index === 0 ? "Front label" : "Back label"} className={styles.labelPhoto} />
            ) : null,
          )}
        </section>
      ) : null}
      <div className={styles.pair}>
        <section className={styles.card} aria-labelledby="ratings">
          <h3 id="ratings" className={styles.cardLabel}>
            Ratings
          </h3>
          {untried ? (
            <p className={styles.unrated}>Not had yet. Once we have, Edit how we got it and rate it.</p>
          ) : (
            <ul className={styles.lines}>
              {ratings.map(({ person, rating }) => (
                <li key={person.user_id} className={styles.rating}>
                  <span className={styles.who}>{person.name}</span>
                  {rating ? (
                    <>
                      <span className={styles.stars} aria-label={`${rating.stars} of 5 stars`}>
                        {starsText(rating.stars)}
                      </span>
                      {rating.buy_again !== null ? <span className={styles.buyAgain}>{buyAgainText(rating.buy_again)}</span> : null}
                      {rating.comment ? <span className={styles.comment}>{rating.comment}</span> : null}
                      <span className={styles.changed}>Changed {changedOn.format(new Date(rating.updated_at))}</span>
                    </>
                  ) : (
                    <span className={styles.unrated}>Not rated yet</span>
                  )}
                </li>
              ))}
            </ul>
          )}
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
