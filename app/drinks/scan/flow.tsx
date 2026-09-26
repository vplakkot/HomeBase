"use client";

import Link from "next/link";
import { useState } from "react";
import { NOTHING_READ } from "../../../lib/drinks/label-reader";
import type { ShopCheck, Summary } from "../../../lib/drinks/match";
import { starsText } from "../../../lib/drinks/drinks";
import cards from "../../../components/cards.module.css";
import { readLabel, type Scan } from "../actions";
import { DrinkForm } from "../forms";
import { appendShots, LabelPhotos, type Shots } from "../photos";
import styles from "../drinks.module.css";

type Step = { at: "photos" } | { at: "reading"; shots: Shots } | ({ at: "review"; shots: Shots } & Scan);

// One drink we already have, as the shop check shows it (REQ-33): its
// name and vintage, and everyone's stars, comment and buy again.
function Match({ drink }: { drink: Summary }) {
  return (
    <li className={styles.match}>
      <span className={styles.cardTitle}>
        {drink.name}
        {drink.vintage ? ` · ${drink.vintage}` : ""}
      </span>
      {drink.producer ? <span className={styles.cardDetail}>{drink.producer}</span> : null}
      {drink.wanted ? <strong className={styles.callout}>On our Want to try list</strong> : null}
      {drink.wanted ? null : (
        <ul className={styles.ratings} aria-label="Ratings">
          {drink.ratings.map((rating) => (
            <li key={rating.name}>
              <span>{rating.name}</span>{" "}
              {rating.stars ? (
                <span className={styles.stars} aria-label={`${rating.stars} of 5 stars`}>
                  {starsText(rating.stars)}
                </span>
              ) : (
                <span className={styles.unrated}>not rated</span>
              )}
              {rating.buyAgain ? <span className={styles.buyAgain}> · {rating.buyAgain}</span> : null}
              {rating.comment ? <span className={styles.comment}> “{rating.comment}”</span> : null}
            </li>
          ))}
        </ul>
      )}
      <Link href={`/drinks/${drink.id}`} className={cards.primary}>
        Open existing
      </Link>
    </li>
  );
}

// REQ-33's answer, straight after reading and before anything is saved.
function CheckResult({ check, onSaveAsNew }: { check: ShopCheck; onSaveAsNew?: () => void }) {
  if (check.kind === "unknown") return null;
  if (check.kind === "new")
    return (
      <section className={styles.check} aria-label="Have we had it?">
        <h2 className={styles.stepTitle}>New to us</h2>
        <p className={styles.unrated}>We haven&apos;t recorded this one. Save it below, or choose Want to try.</p>
      </section>
    );
  return (
    <section className={styles.check} aria-label="Have we had it?">
      <h2 className={styles.stepTitle}>{check.kind === "same" ? "We've had this" : "A different vintage of one we've had"}</h2>
      <ul className={styles.matches}>
        {check.drinks.map((drink) => (
          <Match key={drink.id} drink={drink} />
        ))}
      </ul>
      {onSaveAsNew ? (
        <button type="button" className={cards.quiet} onClick={onSaveAsNew}>
          Save as new
        </button>
      ) : null}
    </section>
  );
}

// Scanning a label (REQ-25, REQ-26, REQ-28): the front photo (then Retake
// or Use it), the back one or Skip, both read together, then the review
// screen: the photos beside the fields read from them. Save keeps the
// drink and its photos; Cancel keeps nothing. Nothing is stored before
// Save: the photos wait in the browser until then.
export function ScanFlow() {
  const [step, setStep] = useState<Step>({ at: "photos" });
  // With the same wine already recorded, the form waits for Save as new.
  const [savingNew, setSavingNew] = useState(false);

  const read = async (shots: Shots) => {
    setStep({ at: "reading", shots });
    const data = new FormData();
    appendShots(data, shots);
    let scan: Scan;
    try {
      scan = await readLabel(data);
    } catch {
      scan = { reading: NOTHING_READ, check: { kind: "unknown" } };
    }
    setSavingNew(false);
    setStep({ at: "review", shots, ...scan });
  };

  if (step.at === "photos")
    return (
      <LabelPhotos
        onDone={read}
        hint={
          <p className={styles.unrated}>
            Camera not opening? Allow it for HomeBase in the iPhone&apos;s Settings, or choose a photo instead.
          </p>
        }
      />
    );

  if (step.at === "reading")
    return (
      <section className={styles.step} aria-label="Reading the label" aria-busy="true">
        <h2 className={styles.stepTitle}>Reading the label…</h2>
        <div className={styles.progress} role="progressbar" aria-label="Reading the label" />
      </section>
    );

  const { shots, reading, check } = step;
  const formShown = check.kind !== "same" || savingNew;
  return (
    <div className={styles.review}>
      <section className={styles.reviewPhotos} aria-label="Label photos">
        {/* eslint-disable-next-line @next/next/no-img-element -- local photos not yet saved */}
        <img src={shots.front.url} alt="Front label" className={styles.preview} />
        {shots.back ? (
          // eslint-disable-next-line @next/next/no-img-element -- local photos not yet saved
          <img src={shots.back.url} alt="Back label" className={styles.preview} />
        ) : null}
      </section>
      <CheckResult
        check={check}
        onSaveAsNew={check.kind === "same" && !savingNew ? () => setSavingNew(true) : undefined}
      />
      {formShown ? (
        <section className={styles.formCard} aria-label="Check the details">
          {reading.found ? null : (
            <div className={styles.notice} role="status">
              <p>Nothing could be read from the label. Fill in what it says, or try another photo.</p>
              <button type="button" className={styles.linkButton} onClick={() => setStep({ at: "photos" })}>
                Try another photo
              </button>
            </div>
          )}
          <DrinkForm initial={reading.fields} unsure={reading.unsure} shots={shots} cancelHref="/drinks" />
        </section>
      ) : null}
    </div>
  );
}
