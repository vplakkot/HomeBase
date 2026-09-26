"use client";

import { useState } from "react";
import type { LabelReading } from "../../../lib/drinks/label-reader";
import { readLabel } from "../actions";
import { DrinkForm } from "../forms";
import { appendShots, LabelPhotos, type Shots } from "../photos";
import styles from "../drinks.module.css";

type Step = { at: "photos" } | { at: "reading"; shots: Shots } | { at: "review"; shots: Shots; reading: LabelReading };

// Scanning a label (REQ-25, REQ-26, REQ-28): the front photo (then Retake
// or Use it), the back one or Skip, both read together, then the review
// screen: the photos beside the fields read from them. Save keeps the
// drink and its photos; Cancel keeps nothing. Nothing is stored before
// Save: the photos wait in the browser until then.
export function ScanFlow() {
  const [step, setStep] = useState<Step>({ at: "photos" });

  const read = async (shots: Shots) => {
    setStep({ at: "reading", shots });
    const data = new FormData();
    appendShots(data, shots);
    let reading: LabelReading;
    try {
      reading = await readLabel(data);
    } catch {
      reading = { found: false, fields: {}, unsure: [] };
    }
    setStep({ at: "review", shots, reading });
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

  const { shots, reading } = step;
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
    </div>
  );
}
