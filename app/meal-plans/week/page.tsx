import Link from "next/link";
import { householdToday } from "../../../lib/finances/budget-year";
import { dayLabel, entryMeals, layoutPlan, mealKey, mealName, mealPlace, planStartMeal, startChoices, startOf, type Meal } from "../../../lib/meal-plans/meals";
import {
  hasDishes,
  planStats,
  readClosedPlan,
  readLastClosedPlan,
  readPlans,
  readPlanRows,
  readProposed,
  type ClosedPlan,
  type MealPlan,
} from "../../../lib/meal-plans/plan";
import { averageRatings, readRatingPrompts, readRatings } from "../../../lib/meal-plans/ratings";
import { readRecipes, type Recipe } from "../../../lib/meal-plans/recipes";
import { suggestions } from "../../../lib/meal-plans/suggest";
import { MealPlansScreen, mealPlansViewer } from "../frame";
import { AddToPlanForm, AddToWeekButton, ChangeStartForm, DaysOffForm, MoveControls, PlanAheadForm, PlannedControls, RateRecipeForm, StartPlanForm } from "../plan-forms";
import { closePlan, removePlan, reopenPlan, setDidntCook, skipRating, startPlanNow, takeOffPlan } from "../plan-actions";
import { readPeople } from "../../../lib/drinks/drinks";
import { readSettings } from "../../../lib/meal-plans/settings";
import { buttonClass } from "../../../components/button";
import { PlanRange } from "../plan-range";
import { RatePrompts } from "../rate-prompts";
import styles from "../meal-plans.module.css";

const UUID = /^[0-9a-f-]{36}$/i;

const asOption = (meal: Meal) => ({ value: mealKey(meal), label: mealPlace(meal) });

// One plan, laid out by meal (REQ-168): a card per entry in meal order,
// each with the meals it covers, and what an empty meal is called ("On
// your own", "Not planned"). `ahead` is the plan queued behind the current
// one (REQ-162): its start isn't ours to change, it follows the current
// plan's last meal.
function PlanCard({ plan, recipes, names, ahead, planned }: { plan: MealPlan; recipes: readonly Recipe[]; names: Map<string, string>; ahead: boolean; planned: ReadonlySet<string> }) {
  const entries = plan.recipes.filter((entry) => entry.eating_out || (entry.recipe_id && names.has(entry.recipe_id)));
  const layout = layoutPlan(plan, entries);
  // Days before today are locked once a plan has started; a new plan hasn't (REQ-163).
  const locked = plan.status === "started" ? householdToday() : null;
  const choicesFor = (shape: { eating_out: boolean; meals: 1 | 2 }) => startChoices(plan, shape, plan.daysOff, locked).map(asOption);
  const choices = { one: choicesFor({ eating_out: false, meals: 1 }), two: choicesFor({ eating_out: false, meals: 2 }) };
  const dishes = entries.filter((entry) => !entry.eating_out).sort((a, b) => startOf(a) - startOf(b));
  // What can be added: not already planned, unless the repeat setting is on (REQ-172),
  // when `planned` is empty.
  const addable = recipes.filter((recipe) => !recipe.hidden && !planned.has(recipe.id));
  const daysOff = [...plan.daysOff].sort().map((day) => ({ day, label: dayLabel(day) }));
  return (
    <section className={styles.formCard} aria-label={ahead ? "Next plan" : "This week"}>
      <div className={styles.fileHead}>
        {ahead ? <p className={styles.rangeMark}>Next week</p> : null}
        <h2 className={styles.title}>
          <PlanRange plan={plan} />
        </h2>
      </div>
      {!ahead && plan.status === "new" ? (
        <div className={styles.inline}>
          <p>Not started. First meal: {mealPlace(planStartMeal(plan))}</p>
          {hasDishes(plan) ? (
            <form action={startPlanNow}>
              <input type="hidden" name="plan_id" value={plan.id} />
              <button type="submit" className={buttonClass}>
                Start
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
      {layout.rows.length > 0 ? (
        <ul className={styles.planList} aria-label={ahead ? "Entries in the next plan" : "Recipes in the plan"}>
          {layout.rows.map((row) => {
            if (row.kind === "empty") {
              return (
                <li key={`empty-${mealKey(row.meal)}`} className={styles.planRow}>
                  <span className={styles.planMeals}>{mealName(row.meal)}</span>
                  <span className={styles.planEmpty}>{row.label}</span>
                </li>
              );
            }
            const { entry } = row;
            const name = entry.eating_out ? "Eating out" : (names.get(entry.recipe_id ?? "") ?? "");
            const place = dishes.indexOf(entry);
            return (
              <li key={entry.id} className={styles.planRow}>
                <span className={styles.planMeals}>{entryMeals(row.meals)}</span>
                {entry.eating_out ? (
                  <span>{name}</span>
                ) : (
                  <Link href={`/meal-plans/${entry.recipe_id}`}>
                    {name}
                  </Link>
                )}
                {entry.eating_out ? null : (
                  <PlannedControls planId={plan.id} entryId={entry.id} name={name} meals={entry.meals} />
                )}
                <MoveControls
                  planId={plan.id}
                  entryId={entry.id}
                  name={name}
                  meals={choicesFor(entry)}
                  canMoveUp={place > 0}
                  canMoveDown={place !== -1 && place < dishes.length - 1}
                />
                <form action={takeOffPlan}>
                  <input type="hidden" name="plan_id" value={plan.id} />
                  <input type="hidden" name="entry_id" value={entry.id} />
                  <button type="submit" className={styles.linkButton} aria-label={`Take ${name} off the plan`}>
                    Remove
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      ) : null}
      {recipes.length === 0 ? (
        <p className={styles.empty}>
          No recipes yet.{" "}
          <Link href="/meal-plans/new" className={styles.textLink}>
            Add one
          </Link>{" "}
          first.
        </p>
      ) : null}
      <AddToPlanForm planId={plan.id} recipes={addable} choices={choices} />
      <details className={styles.startDay}>
        <summary className={styles.linkButton}>Days off</summary>
        <DaysOffForm planId={plan.id} days={daysOff} />
      </details>
      {ahead ? null : (
        <>
          <details className={styles.startDay}>
            <summary className={styles.linkButton}>Change the start day</summary>
            <ChangeStartForm planId={plan.id} startsOn={plan.starts_on} />
          </details>
          {plan.status === "started" ? (
            <form action={closePlan}>
              <input type="hidden" name="plan_id" value={plan.id} />
              <button type="submit" className={styles.linkButton}>
                Close plan
              </button>
            </form>
          ) : null}
        </>
      )}
      <form action={removePlan}>
        <input type="hidden" name="plan_id" value={plan.id} />
        <button type="submit" className={styles.linkButton}>
          Remove this plan
        </button>
      </form>
    </section>
  );
}

// REQ-163: when a plan closes every dish gets a closing card. It counts as
// cooked unless we say "Didn't cook this" (and can take that back). A dish
// we didn't cook can go straight into next week's plan; with no plan for next
// week yet it is proposed first when one is created.
function ClosingCards({ closed, names, ahead, toRate }: { closed: ClosedPlan | null; names: Map<string, string>; ahead: MealPlan | null; toRate: ReadonlySet<string> }) {
  const cards = closed?.cards.filter((card) => names.has(card.recipeId)) ?? [];
  if (cards.length === 0) return null;
  return (
    <section className={styles.section} aria-label="Closing cards">
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Last plan</h2>
      </div>
      <ul className={styles.planList}>
        {cards.map((card) => {
          const name = names.get(card.recipeId) ?? "";
          const inNextWeek = ahead?.recipes.some((entry) => entry.recipe_id === card.recipeId) ?? false;
          return (
            <li key={card.entryId} className={styles.planRow}>
              <Link href={`/meal-plans/${card.recipeId}`}>{name}</Link>
              {card.didntCook ? <span className={styles.tag}>Didn&apos;t cook</span> : null}
              {/* A dish cooked for the first time asks each of us for a rating, on the same card. */}
              {!card.didntCook && toRate.has(card.recipeId) ? (
                <>
                  <RateRecipeForm recipeId={card.recipeId} name={name} stars={null} />
                  <form action={skipRating}>
                    <input type="hidden" name="recipe_id" value={card.recipeId} />
                    <button type="submit" className={styles.linkButton} aria-label={`Skip rating ${name}`}>
                      Skip
                    </button>
                  </form>
                </>
              ) : null}
              <form action={setDidntCook}>
                <input type="hidden" name="entry_id" value={card.entryId} />
                <input type="hidden" name="recipe_id" value={card.recipeId} />
                <input type="hidden" name="didnt_cook" value={card.didntCook ? "no" : "yes"} />
                <button type="submit" className={styles.linkButton} aria-label={`${card.didntCook ? "Cooked" : "Didn't cook"}: ${name}`}>
                  {card.didntCook ? "Cooked" : "Didn't cook"}
                </button>
              </form>
              {card.didntCook && ahead && !inNextWeek ? <AddToWeekButton planId={ahead.id} recipeId={card.recipeId} label="Add to next week" /> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// REQ-115: the plans, the same ones for both of us. REQ-164: laid out by
// meal. REQ-162: one more can be planned ahead while this one runs.
// REQ-116: closing it, and rating what we cooked. REQ-117: suggestions
// while we plan; "Not now" drops one for this visit (it's kept in the
// address).
export default async function WeekPage({ searchParams }: { searchParams?: Promise<{ skip?: string; start?: string }> } = {}) {
  const viewer = await mealPlansViewer();
  const query = (await searchParams) ?? {};
  const [{ current: plan, ahead }, lastClosed, recipes, rows, ratings, prompts, proposed, closed, people, settings] = await Promise.all([
    readPlans(viewer.supabase),
    readLastClosedPlan(viewer.supabase),
    readRecipes(viewer.supabase),
    readPlanRows(viewer.supabase),
    readRatings(viewer.supabase),
    readRatingPrompts(viewer.supabase, viewer.userId),
    readProposed(viewer.supabase),
    readClosedPlan(viewer.supabase, householdToday()),
    readPeople(viewer.supabase),
    readSettings(viewer.supabase),
  ]);
  const names = new Map(recipes.map((recipe) => [recipe.id, recipe.name]));
  const toRate = prompts.flatMap((id) => (names.has(id) ? [{ id, name: names.get(id) ?? "" }] : []));
  // A dish on the last plan's closing cards is rated on its card; "Rate these" keeps only the rest.
  const onCards = new Set(closed?.cards.map((card) => card.recipeId) ?? []);
  const rateElsewhere = toRate.filter((recipe) => !onCards.has(recipe.id));
  const rateOnCards = new Set(toRate.map((recipe) => recipe.id));
  const today = householdToday();
  if (!plan) {
    return (
      <MealPlansScreen viewer={viewer} section="This week">
        <RatePrompts recipes={rateElsewhere} />
        <ClosingCards closed={closed} names={names} ahead={null} toRate={rateOnCards} />
        <section className={styles.formCard} aria-label="This week">
          <h2 className={styles.title}>No plan yet</h2>
          <StartPlanForm today={today} label="New meal plan" />
          {lastClosed ? (
            <form action={reopenPlan}>
              <input type="hidden" name="plan_id" value={lastClosed} />
              <button type="submit" className={styles.linkButton}>
                Reopen the last plan
              </button>
            </form>
          ) : null}
        </section>
      </MealPlansScreen>
    );
  }
  // REQ-172: with "Repeat recipes in a plan" off, a recipe already in the plan we're on or in
  // next week's is neither offered to add nor suggested; with it on, nothing is held back.
  const inPlan = settings.repeatRecipes ? new Set<string>() : new Set([...plan.recipes, ...(ahead?.recipes ?? [])].flatMap((entry) => (entry.recipe_id ? [entry.recipe_id] : [])));
  // REQ-169: dishes a push took off a plan, proposed first for next week's plan.
  const proposedFirst = recipes.filter((recipe) => proposed.includes(recipe.id) && !recipe.hidden && !inPlan.has(recipe.id));
  // Opened from the "Start this week's plan?" notification after the other person already pressed Start (REQ-163).
  const starter = plan.began_by ? people.find((person) => person.user_id === plan.began_by) : null;
  const startedNotice =
    query.start === plan.id && plan.status === "started" && plan.began_by !== viewer.userId ? `${starter?.name ?? "Someone"} already started this plan` : null;
  const skipped = (query.skip ?? "").split(",").filter((id) => UUID.test(id));
  const suggested = suggestions({
    recipes,
    stats: planStats(rows),
    averages: averageRatings(ratings),
    // Carried-over dishes now come through the closing cards and "Proposed for next week" (REQ-163).
    carried: [],
    inPlan,
    dismissed: new Set(skipped),
    today,
  });
  return (
    <MealPlansScreen viewer={viewer} section="This week">
      {startedNotice ? <p role="status">{startedNotice}</p> : null}
      <RatePrompts recipes={rateElsewhere} />
      <ClosingCards closed={closed} names={names} ahead={ahead} toRate={rateOnCards} />
      <PlanCard plan={plan} recipes={recipes} names={names} ahead={false} planned={inPlan} />
      {suggested.length > 0 ? (
        <section className={styles.section} aria-label="Suggestions">
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Suggestions</h2>
          </div>
          <ul className={styles.planList}>
            {suggested.map(({ recipe, label }) => (
              <li key={recipe.id} className={styles.planRow}>
                <Link href={`/meal-plans/${recipe.id}`}>{recipe.name}</Link>
                {label ? <span className={styles.tag}>{label}</span> : null}
                <AddToWeekButton planId={plan.id} recipeId={recipe.id} label="Add" />
                <Link href={`/meal-plans/week?skip=${[...skipped, recipe.id].join(",")}`} className={styles.linkButton} aria-label={`Not now: ${recipe.name}`}>
                  Not now
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {ahead && proposedFirst.length > 0 ? (
        <section className={styles.section} aria-label="Proposed for next week">
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Proposed for next week</h2>
          </div>
          <ul className={styles.planList}>
            {proposedFirst.map((recipe) => (
              <li key={recipe.id} className={styles.planRow}>
                <Link href={`/meal-plans/${recipe.id}`}>{recipe.name}</Link>
                <AddToWeekButton planId={ahead.id} recipeId={recipe.id} label="Add" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {ahead ? (
        <PlanCard plan={ahead} recipes={recipes} names={names} ahead planned={inPlan} />
      ) : (
        <section className={styles.formCard} aria-label="Next plan">
          <PlanAheadForm />
        </section>
      )}
    </MealPlansScreen>
  );
}
