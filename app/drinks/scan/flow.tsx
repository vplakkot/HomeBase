"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { NOTHING_READ } from "../../../lib/drinks/label-reader";
import type { ShopCheck, Summary } from "../../../lib/drinks/match";
import { starsText } from "../../../lib/drinks/drinks";
import cards from "../../../components/cards.module.css";
import { checkDrink, readLabel, type Scan } from "../actions";
import { DrinkForm } from "../forms";
import { appendShots, LabelPhotos, type Shots } from "../photos";
import { heldPhoto, releasePhoto } from "./pending";
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

// Scanning a label (REQ-25, REQ-26, REQ-28, REQ-122): the front photo,
// usually already taken by the header's Scan, then Read it or a back
// photo that goes on by itself; both are read together, then the review
// screen: the photos beside the fields read from them. Save keeps the
// drink and its photos; Cancel keeps nothing. Nothing is stored before
// Save: the photos wait in the browser until then.
export function ScanFlow() {
  const [step, setStep] = useState<Step>({ at: "photos" });
  // The photo the header's Scan took, picked up once.
  const [held, setHeld] = useState(heldPhoto);
  useEffect(() => releasePhoto(), []);
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
        held={held}
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

  return <Review step={step} again={() => {
        setHeld(null);
        setStep({ at: "photos" });
      }} savingNew={savingNew} setSavingNew={setSavingNew} />;
}

// The review screen (REQ-28) with the shop check above it (REQ-33).
// Correcting the name, producer or vintage checks again, half a second
// after the typing stops; the form stays open while that happens.
function Review({
  step,
  again,
  savingNew,
  setSavingNew,
}: {
  step: { at: "review"; shots: Shots } & Scan;
  again: () => void;
  savingNew: boolean;
  setSavingNew: (open: boolean) => void;
}) {
  const [check, setCheck] = useState<ShopCheck>(step.check);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);
  const recheck = (fields: { name: string; producer: string; vintage: string }) => {
    // Editing means the form is in use: a match found now shows above it
    // without hiding it.
    setSavingNew(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        setCheck(await checkDrink(fields));
      } catch {
        // Keep the last answer; saving still works.
      }
    }, 500);
  };
  const { shots, reading } = step;
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
      {/* REQ-122: a retake is always possible here. */}
      <button type="button" className={styles.linkButton} onClick={again}>
        Try another photo
      </button>
      <CheckResult
        check={check}
        onSaveAsNew={check.kind === "same" && !savingNew ? () => setSavingNew(true) : undefined}
      />
      {formShown ? (
        <section className={styles.formCard} aria-label="Check the details">
          {reading.found ? null : (
            <div className={styles.notice} role="status">
              <p>Nothing could be read from the label. Fill in what it says, or try another photo.</p>
            </div>
          )}
          <DrinkForm
            initial={reading.fields}
            unsure={reading.unsure}
            shots={shots}
            cancelHref="/drinks"
            onIdentity={recheck}
          />
        </section>
      ) : null}
    </div>
  );
}
