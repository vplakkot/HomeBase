"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { markImportSeen, myRecipeImports } from "../app/meal-plans/actions";
import { cutDraftPhotos } from "../lib/meal-plans/draft-photo";
import {
  announceImportsChanged,
  dismissNote,
  forgetImports,
  importsRemembered,
  noteDismissed,
} from "../lib/meal-plans/import-flag";
import type { RecipeImport } from "../lib/meal-plans/recipes";
import { currentUploads, watchUploads, type UploadProgress } from "../lib/meal-plans/video-upload";
import styles from "./recipe-toast.module.css";

// REQ-112 (BETA): news of a recipe being read from a video, on whatever
// page you're on. While the video is sending it shows how far along it
// is; while Gemini reads it, that it's reading; then "Recipe ready" with
// the way to the draft, or plainly that it failed. Nothing about it is
// urgent, so it checks every 15 seconds, and only while this browser has
// an import going.
const CHECK_MS = 15_000;

const NO_UPLOADS: UploadProgress[] = [];

// REQ-166: tapping "Save recipe" opens the draft, and a new toast is born
// on that page; it asks the server what is waiting before the server has
// heard "seen", so the note came back and needed a second tap. The tab
// remembers what it dismissed (import-flag.ts) and doesn't show it again.

export function RecipeToast() {
  const uploads = useSyncExternalStore(watchUploads, currentUploads, () => NO_UPLOADS);
  const [imports, setImports] = useState<RecipeImport[]>([]);
  // What the server said last time (id → stage), to notice a change (REQ-167).
  const heard = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const check = async () => {
      if (!importsRemembered() && currentUploads().length === 0) return;
      const found = await myRecipeImports().catch(() => null);
      if (stopped || !found) return;
      // REQ-156: the photo Gemini chose is cut out before the note says
      // the recipe is ready, so the draft opens with it.
      await cutDraftPhotos(found);
      if (stopped) return;
      setImports(found.filter((item) => !noteDismissed(item.id)));
      const now = new Map(found.map((item) => [item.id, item.status]));
      const before = heard.current;
      heard.current = now;
      if (before && (now.size !== before.size || [...now].some(([id, status]) => before.get(id) !== status))) {
        announceImportsChanged();
      }
      const going = found.some((item) => item.status === "uploading" || item.status === "processing") || currentUploads().length > 0;
      if (found.length === 0 && !going) forgetImports();
      if (going) timer = setTimeout(check, CHECK_MS);
    };
    void check();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [uploads.length]);

  const dismiss = (id: string) => {
    dismissNote(id);
    setImports((list) => list.filter((item) => item.id !== id));
    void markImportSeen(id);
  };

  const sending = new Set(uploads.map((item) => item.id));
  const notes = [
    ...uploads.map((upload) => (
      <li key={upload.id} className={styles.toast}>
        <span>
          {upload.paused ? "Paused sending" : "Sending"} “{upload.name}” · {Math.floor((upload.sent / upload.total) * 100)}%
        </span>
      </li>
    )),
    ...imports
      // An upload this browser isn't sending (another device, or a
      // reload that lost the file) is left to the Meal Plan overview.
      .filter((item) => item.status !== "uploading" && !sending.has(item.id))
      .map((item) => (
        <li key={item.id} className={styles.toast} role={item.status === "processing" ? undefined : "status"}>
          {item.status === "processing" ? (
            <span>Reading “{item.name}”…</span>
          ) : item.status === "ready" ? (
            <>
              <span>Recipe ready: {item.name}</span>
              <Link href={`/meal-plans/drafts/${item.id}`} onClick={() => dismiss(item.id)} className={styles.action}>
                Save recipe
              </Link>
            </>
          ) : (
            <>
              <span>Couldn&apos;t read “{item.name}”</span>
              <Link href={`/meal-plans/drafts/${item.id}`} onClick={() => dismiss(item.id)} className={styles.action}>
                See why
              </Link>
            </>
          )}
          {item.status !== "processing" ? (
            <button type="button" className={styles.close} aria-label="Dismiss" onClick={() => dismiss(item.id)}>
              ×
            </button>
          ) : null}
        </li>
      )),
  ];
  if (notes.length === 0) return null;
  return (
    // data-recipe-toast: while a note is showing on a phone, it stands in for
    // Meal Plans' pinned "Add recipe" bar (module-bar.module.css), so the
    // bottom of the screen says one thing: reading, then Save recipe.
    <ul className={styles.toasts} data-recipe-toast="" aria-live="polite" aria-label="Recipes on their way">
      {notes}
    </ul>
  );
}


