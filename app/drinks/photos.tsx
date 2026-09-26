"use client";

import { useEffect, useRef, useState } from "react";
import cards from "../../components/cards.module.css";
import { shrinkPhoto } from "../../lib/drinks/shrink-photo";
import type { Source } from "./scan/pending";
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

// A hidden file picker. `capture` asks a phone to open the camera
// straight away; without it, the photo library opens.
function Picker({
  label,
  source,
  input,
  onPicked,
}: {
  label: string;
  source: Source;
  input: React.RefObject<HTMLInputElement | null>;
  onPicked: (file: File) => void;
}) {
  return (
    <input
      ref={input}
      type="file"
      accept="image/*"
      capture={source === "camera" ? "environment" : undefined}
      className={styles.hiddenLabel}
      aria-label={label}
      onChange={() => {
        const file = input.current?.files?.[0];
        if (file) onPicked(file);
        if (input.current) input.current.value = "";
      }}
    />
  );
}

async function shoot(file: File): Promise<Shot> {
  const { full, thumb } = await shrinkPhoto(file);
  return { full, thumb, url: URL.createObjectURL(full) };
}

// The label photos in as few taps as we can (REQ-25, REQ-26, REQ-122):
// the front comes from the camera or a photo already taken (or arrives
// already taken, from the header's Scan). Then one screen: Read it with
// the front alone, Add back label, or Retake. The back and a retake come
// the same way the front did, and a back photo goes on by itself.
export function LabelPhotos({
  onDone,
  held,
  done = "Read it",
  hint,
}: {
  onDone: (shots: Shots) => void;
  held?: { file: File; source: Source } | null;
  done?: string;
  hint?: React.ReactNode;
}) {
  const [front, setFront] = useState<{ shot: Shot; source: Source } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputs = {
    camera: useRef<HTMLInputElement>(null),
    library: useRef<HTMLInputElement>(null),
    backCamera: useRef<HTMLInputElement>(null),
    backLibrary: useRef<HTMLInputElement>(null),
  };

  const ready = async (file: File, use: (shot: Shot) => void) => {
    setBusy(true);
    setError(null);
    try {
      use(await shoot(file));
    } catch {
      setError("That photo couldn't be opened. Try another.");
    } finally {
      setBusy(false);
    }
  };
  // A retake replaces the front; its old local address is let go. After
  // Read it the next screens still show it, so that one is kept.
  const takeFront = (source: Source) => (file: File) =>
    ready(file, (shot) =>
      setFront((old) => {
        if (old) URL.revokeObjectURL(old.shot.url);
        return { shot, source };
      }),
    );
  const takeBack = (file: File) => ready(file, (back) => front && onDone({ front: front.shot, back }));

  const first = useRef(held);
  useEffect(() => {
    const photo = first.current;
    first.current = null;
    if (photo) void takeFront(photo.source)(photo.file);
    // Only the photo the screen opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickers = (
    <>
      <Picker label="Take the front label" source="camera" input={inputs.camera} onPicked={takeFront("camera")} />
      <Picker label="Choose a photo" source="library" input={inputs.library} onPicked={takeFront("library")} />
      <Picker label="Take the back label" source="camera" input={inputs.backCamera} onPicked={takeBack} />
      <Picker label="Choose the back label" source="library" input={inputs.backLibrary} onPicked={takeBack} />
    </>
  );
  const status = (
    <>
      {busy ? <p className={styles.unrated}>Getting the photo ready…</p> : null}
      {error ? (
        <p role="alert" className={cards.error}>
          {error}
        </p>
      ) : null}
    </>
  );

  if (!front)
    return (
      <section className={styles.step} aria-label="Front label">
        <h2 className={styles.stepTitle}>Front label</h2>
        {pickers}
        {held && busy ? null : (
          <div className={styles.pickers}>
            <button type="button" className={cards.primary} disabled={busy} onClick={() => inputs.camera.current?.click()}>
              Take the front label
            </button>
            <button type="button" className={cards.quiet} disabled={busy} onClick={() => inputs.library.current?.click()}>
              Choose a photo
            </button>
          </div>
        )}
        {status}
        {busy ? null : hint}
      </section>
    );

  const fromCamera = front.source === "camera";
  return (
    <section className={styles.step} aria-label="Front label">
      <h2 className={styles.stepTitle}>Front label</h2>
      {pickers}
      {/* eslint-disable-next-line @next/next/no-img-element -- a local photo not yet saved */}
      <img src={front.shot.url} alt="Front label, as taken" className={styles.preview} />
      <div className={styles.pickers}>
        <button type="button" className={cards.primary} disabled={busy} onClick={() => onDone({ front: front.shot })}>
          {done}
        </button>
        <button
          type="button"
          className={cards.quiet}
          disabled={busy}
          onClick={() => (fromCamera ? inputs.backCamera : inputs.backLibrary).current?.click()}
        >
          Add back label
        </button>
        <button
          type="button"
          className={cards.quiet}
          disabled={busy}
          onClick={() => (fromCamera ? inputs.camera : inputs.library).current?.click()}
        >
          Retake
        </button>
      </div>
      {status}
    </section>
  );
}
