"use client";

import { useRef, useState } from "react";
import cards from "../../components/cards.module.css";
import { shrinkPhoto } from "../../lib/drinks/shrink-photo";
import styles from "./drinks.module.css";

// A label photo ready to send: shrunk in the browser (REQ-32), with a
// local address to show it before anything is saved.
export type Shot = { full: Blob; thumb: Blob; url: string };

export type Shots = { front: Shot; back?: Shot };

// Adds the photos to a form's data under the names the actions read.
export function appendShots(formData: FormData, shots: Shots) {
  formData.append("front", shots.front.full, "front.jpg");
  formData.append("front_thumb", shots.front.thumb, "front-thumb.jpg");
  if (shots.back) {
    formData.append("back", shots.back.full, "back.jpg");
    formData.append("back_thumb", shots.back.thumb, "back-thumb.jpg");
  }
}

// The two ways in (REQ-25, REQ-26): the phone's own camera, or a photo
// already taken. Both are the browser's file picker: `capture` asks a
// phone to open the camera straight away. A web page can't see whether
// camera access was refused, so the way round it is always on screen.
function Pickers({
  take,
  onPicked,
  busy,
  choose = "Choose a photo",
}: {
  take: string;
  onPicked: (file: File) => void;
  busy: boolean;
  choose?: string;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const picked = (input: HTMLInputElement | null) => {
    const file = input?.files?.[0];
    if (file) onPicked(file);
    if (input) input.value = "";
  };
  return (
    <div className={styles.pickers}>
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        className={styles.hiddenLabel}
        aria-label={take}
        onChange={() => picked(camera.current)}
      />
      <input
        ref={library}
        type="file"
        accept="image/*"
        className={styles.hiddenLabel}
        aria-label={choose}
        onChange={() => picked(library.current)}
      />
      <button type="button" className={cards.primary} disabled={busy} onClick={() => camera.current?.click()}>
        {take}
      </button>
      <button type="button" className={cards.quiet} disabled={busy} onClick={() => library.current?.click()}>
        {choose}
      </button>
    </div>
  );
}

async function shoot(file: File): Promise<Shot> {
  const { full, thumb } = await shrinkPhoto(file);
  return { full, thumb, url: URL.createObjectURL(full) };
}

// One label photo: take or choose it, see it, then Retake or Use it
// (REQ-25).
export function PhotoStep({
  title,
  take,
  onUse,
  extra,
}: {
  title: string;
  take: string;
  onUse: (shot: Shot) => void;
  extra?: React.ReactNode;
}) {
  const [shot, setShot] = useState<Shot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picked = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      setShot(await shoot(file));
    } catch {
      setError("That photo couldn't be opened. Try another.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={styles.step} aria-label={title}>
      <h2 className={styles.stepTitle}>{title}</h2>
      {shot ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- a local photo not yet saved */}
          <img src={shot.url} alt={`${title}, as taken`} className={styles.preview} />
          <div className={styles.pickers}>
            <button type="button" className={cards.primary} onClick={() => onUse(shot)}>
              Use it
            </button>
            {/* The photo's local address is let go only on Retake: after Use it,
                the next screens still show it. */}
            <button
              type="button"
              className={cards.quiet}
              onClick={() => {
                URL.revokeObjectURL(shot.url);
                setShot(null);
              }}
            >
              Retake
            </button>
          </div>
        </>
      ) : (
        <>
          <Pickers take={take} onPicked={picked} busy={busy} />
          {busy ? <p className={styles.unrated}>Getting the photo ready…</p> : null}
          {extra}
        </>
      )}
      {error ? (
        <p role="alert" className={cards.error}>
          {error}
        </p>
      ) : null}
    </section>
  );
}

// Front, then "Add back label" or "Skip" (REQ-25, and the Notion decision
// on an optional back label). Hands both on together.
export function LabelPhotos({ onDone, hint }: { onDone: (shots: Shots) => void; hint?: React.ReactNode }) {
  const [front, setFront] = useState<Shot | null>(null);
  const [addingBack, setAddingBack] = useState(false);
  if (!front) return <PhotoStep title="Front label" take="Take the front label" onUse={setFront} extra={hint} />;
  if (addingBack) return <PhotoStep title="Back label" take="Take the back label" onUse={(back) => onDone({ front, back })} />;
  return (
    <section className={styles.step} aria-label="Back label">
      {/* eslint-disable-next-line @next/next/no-img-element -- a local photo not yet saved */}
      <img src={front.url} alt="Front label, as taken" className={styles.previewSmall} />
      <p>Back labels often show the grapes and alcohol. Add one?</p>
      <div className={styles.pickers}>
        <button type="button" className={cards.primary} onClick={() => setAddingBack(true)}>
          Add back label
        </button>
        <button type="button" className={cards.quiet} onClick={() => onDone({ front })}>
          Skip
        </button>
      </div>
    </section>
  );
}
