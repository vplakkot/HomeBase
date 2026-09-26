"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useState } from "react";
import cards from "../../components/cards.module.css";
import { buttonClass } from "../../components/button";
import { Hint } from "../../components/hint";
import { shrinkPhoto } from "../../lib/drinks/shrink-photo";
import { VIDEO_TYPES } from "../../lib/meal-plans/video-types";
import { COOKING_METHODS, MAIN_MEATS, type Ingredient, type Recipe, type RecipeDraft } from "../../lib/meal-plans/recipes";
import { rememberImports } from "../../lib/meal-plans/import-flag";
import { sendVideo } from "../../lib/meal-plans/video-upload";
import { stillFromVideo } from "../../lib/meal-plans/video-still";
import {
  addRecipe,
  draftFromText,
  saveDraft,
  setRecipePhoto,
  startVideoImport,
  updateRecipe,
  uploadFailed,
  videoProgress,
  type FormState,
} from "./actions";
import styles from "./meal-plans.module.css";

const initialState: FormState = {};

function Outcome({ state }: { state: FormState | { error?: string } }) {
  return state?.error ? (
    <p role="alert" className={cards.error}>
      {state.error}
    </p>
  ) : null;
}

export function Beta() {
  return <span className={styles.beta}>BETA</span>;
}

// REQ-111: fields Gemini filled without being told are marked to check.
function Check() {
  return <em className={styles.unsure}> · check this</em>;
}

type Way = "video" | "text" | "blank";

const WAYS: { value: Way; label: string }[] = [
  { value: "video", label: "From a video" },
  { value: "text", label: "Paste or type it" },
  { value: "blank", label: "Fill in the card" },
];

// Add recipe: from a video (REQ-112, BETA), from text in any form
// (REQ-111), or an empty card to fill in.
export function AddRecipe() {
  const [way, setWay] = useState<Way>("video");
  return (
    <>
      <fieldset className={styles.choices}>
        <legend>How</legend>
        <div className={styles.choiceRow}>
          {WAYS.map((option) => (
            <label key={option.value} className={styles.choice}>
              <input type="radio" name="way" value={option.value} checked={way === option.value} onChange={() => setWay(option.value)} />
              <span>
                {option.label}
                {option.value === "video" ? <Beta /> : null}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {way === "video" ? <VideoForm /> : way === "text" ? <TextForm /> : <RecipeForm />}
    </>
  );
}

function mimeOf(file: File): string {
  if (VIDEO_TYPES[file.type]) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  return Object.entries(VIDEO_TYPES).find(([, ext]) => ext === extension)?.[0] ?? file.type;
}

// Sends the video and hands it to the server to read. Not tied to this
// screen: it carries on while you move around HomeBase, and the toast
// reports how it's going.
function upload(id: string, name: string, url: string, file: File) {
  void sendVideo({ id, name, url, file, check: () => videoProgress(id) }).catch(() => uploadFailed(id));
}

function VideoForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("video");
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose the video.");
      return;
    }
    setBusy(true);
    setError(null);
    const data = new FormData();
    const name = String(form.get("name") ?? "");
    data.set("name", name);
    data.set("video_url", String(form.get("video_url") ?? ""));
    data.set("size", String(file.size));
    data.set("mime", mimeOf(file));
    const still = await stillFromVideo(file);
    if (still) {
      const photo = await shrinkPhoto(still).catch(() => null);
      if (photo) {
        data.set("photo", photo.full, "still.jpg");
        data.set("photo_thumb", photo.thumb, "still-thumb.jpg");
      }
    }
    const started = await startVideoImport(data);
    if ("error" in started) {
      setError(started.error);
      setBusy(false);
      return;
    }
    rememberImports();
    upload(started.id, name, started.uploadUrl, file);
    router.push("/meal-plans");
  };
  return (
    <form onSubmit={submit} className={cards.form}>
      <label className={cards.field}>
        <span className={styles.labelRow}>
          Name
          <Hint text="Gemini reads the video while you do other things, and a note says when the recipe is ready. Keep HomeBase open until the video has sent." />
        </span>
        <input name="name" required placeholder="What the dish is called" autoComplete="off" />
      </label>
      <label className={cards.field}>
        <span>Link to the video (optional)</span>
        <input name="video_url" type="url" inputMode="url" placeholder="https://www.instagram.com/reel/…" autoComplete="off" />
      </label>
      <label className={cards.field}>
        <span>The downloaded video</span>
        <input name="video" type="file" accept="video/*" required />
      </label>
      {error ? (
        <p role="alert" className={cards.error}>
          {error}
        </p>
      ) : null}
      <button type="submit" className={buttonClass} disabled={busy}>
        {busy ? "Starting…" : "Read the recipe"}
      </button>
    </form>
  );
}

function TextForm() {
  const [state, formAction, pending] = useActionState(draftFromText, initialState);
  return (
    <form action={formAction} className={cards.form}>
      <label className={cards.field}>
        <span>Name</span>
        <input name="name" required placeholder="What the dish is called" autoComplete="off" />
      </label>
      <label className={cards.field}>
        <span>The recipe</span>
        <textarea name="recipe" required className={styles.recipeInput} placeholder="A full recipe, a list of ingredients, or rough notes" />
      </label>
      <Outcome state={state} />
      <button type="submit" className={buttonClass} disabled={pending}>
        {pending ? "Gemini is writing the card…" : "Make the card"}
      </button>
    </form>
  );
}

const EMPTY_INGREDIENT: Ingredient = { quantity: "", unit: "", item: "", note: "" };

function Ingredients({ initial }: { initial: Ingredient[] }) {
  const [rows, setRows] = useState<{ key: number; value: Ingredient }[]>(() =>
    (initial.length > 0 ? initial : [EMPTY_INGREDIENT]).map((value, key) => ({ key, value })),
  );
  const [next, setNext] = useState(rows.length);
  return (
    <fieldset className={styles.ingredientList}>
      <legend>Ingredients</legend>
      {rows.map(({ key, value }, index) => (
        <div key={key} className={styles.ingredientRow}>
          <label className={`${cards.field} ${styles.item}`}>
            <span>Ingredient</span>
            <input name="item" defaultValue={value.item} autoComplete="off" />
          </label>
          <button
            type="button"
            className={styles.remove}
            aria-label={`Remove ingredient ${index + 1}`}
            onClick={() => setRows(rows.filter((row) => row.key !== key))}
          >
            ×
          </button>
          <label className={`${cards.field} ${styles.quantity}`}>
            <span>Amount</span>
            <input name="quantity" defaultValue={value.quantity} autoComplete="off" />
          </label>
          <label className={`${cards.field} ${styles.unit}`}>
            <span>Unit</span>
            <input name="unit" defaultValue={value.unit} autoComplete="off" />
          </label>
          <label className={`${cards.field} ${styles.note}`}>
            <span>Note (optional)</span>
            <input name="note" defaultValue={value.note} autoComplete="off" />
          </label>
        </div>
      ))}
      <button
        type="button"
        className={styles.linkButton}
        onClick={() => {
          setRows([...rows, { key: next, value: EMPTY_INGREDIENT }]);
          setNext(next + 1);
        }}
      >
        Add an ingredient
      </button>
    </fieldset>
  );
}

// A recipe card's fields (REQ-110). Three uses: reviewing a draft before
// it's saved (REQ-111, REQ-112: nothing is saved until then), filling in
// an empty card, and changing a saved recipe.
export function RecipeForm({
  recipe,
  draft,
  importId,
  name,
  videoUrl,
  cuisines = [],
}: {
  recipe?: Recipe;
  draft?: RecipeDraft;
  importId?: string;
  name?: string;
  videoUrl?: string | null;
  cuisines?: readonly string[];
}) {
  const action = importId ? saveDraft : recipe ? updateRecipe : addRecipe;
  const [state, formAction, pending] = useActionState(action, initialState);
  const v = recipe ?? draft;
  const check = (field: string) => (draft?.guessed.includes(field) ? <Check /> : null);
  return (
    <form action={formAction} className={cards.form}>
      {recipe ? <input type="hidden" name="id" value={recipe.id} /> : null}
      {importId ? <input type="hidden" name="import_id" value={importId} /> : null}
      <datalist id="cuisine-list">
        {cuisines.map((cuisine) => (
          <option key={cuisine} value={cuisine} />
        ))}
      </datalist>
      <label className={cards.field}>
        <span>Name</span>
        <input name="name" required defaultValue={recipe?.name ?? name ?? draft?.name ?? ""} autoComplete="off" />
      </label>
      <div className={styles.pairFields}>
        <label className={cards.field}>
          <span>Cuisine{check("cuisine")}</span>
          <input name="cuisine" list="cuisine-list" defaultValue={v?.cuisine ?? ""} autoComplete="off" />
        </label>
        <label className={cards.field}>
          <span>Main meat{check("main_meat")}</span>
          <select name="main_meat" defaultValue={v?.main_meat ?? ""}>
            <option value="">Not set</option>
            {[...MAIN_MEATS, ...(v?.main_meat && !MAIN_MEATS.includes(v.main_meat as never) ? [v.main_meat] : [])].map((meat) => (
              <option key={meat} value={meat}>
                {meat}
              </option>
            ))}
          </select>
        </label>
        <label className={cards.field}>
          <span>Cooking method{check("cooking_method")}</span>
          <select name="cooking_method" defaultValue={v?.cooking_method ?? ""}>
            <option value="">Not set</option>
            {COOKING_METHODS.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>
        </label>
        <label className={cards.field}>
          <span>Cook time, minutes{check("cook_minutes")}</span>
          <input name="cook_minutes" inputMode="numeric" defaultValue={v?.cook_minutes ?? ""} autoComplete="off" />
        </label>
        <label className={cards.field}>
          <span>Servings{check("servings")}</span>
          <input name="servings" inputMode="numeric" defaultValue={v?.servings ?? ""} autoComplete="off" />
        </label>
      </div>
      <Ingredients initial={v?.ingredients ?? []} />
      <label className={cards.field}>
        <span>Steps, one per line</span>
        <textarea name="steps" className={styles.stepsInput} defaultValue={(v?.steps ?? []).join("\n")} />
      </label>
      <label className={cards.field}>
        <span>Notes (optional)</span>
        <textarea name="notes" defaultValue={v?.notes ?? ""} />
      </label>
      <div className={styles.pairFields}>
        <label className={cards.field}>
          <span>Video link (optional)</span>
          <input name="video_url" type="url" inputMode="url" defaultValue={recipe?.video_url ?? videoUrl ?? ""} autoComplete="off" />
        </label>
        <label className={cards.field}>
          <span>Recipe page link (optional)</span>
          <input name="page_url" type="url" inputMode="url" defaultValue={recipe?.page_url ?? ""} autoComplete="off" />
        </label>
      </div>
      <Outcome state={state} />
      <div className={cards.actions}>
        <button type="submit" className={buttonClass} disabled={pending}>
          {pending ? "Saving…" : importId ? "Save recipe" : recipe ? "Save changes" : "Save recipe"}
        </button>
        <Link href={recipe ? `/meal-plans/${recipe.id}` : "/meal-plans"}>Cancel</Link>
      </div>
    </form>
  );
}

// REQ-110: our own photo in place of the video's still (or the first one).
export function PhotoForm({ recipeId }: { recipeId: string }) {
  const [state, formAction, pending] = useActionState(setRecipePhoto, initialState);
  const [busy, setBusy] = useState(false);
  const choose = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    const photo = await shrinkPhoto(file).catch(() => null);
    setBusy(false);
    if (!photo) return;
    const data = new FormData();
    data.set("id", recipeId);
    data.set("photo", photo.full, "photo.jpg");
    data.set("photo_thumb", photo.thumb, "photo-thumb.jpg");
    startTransition(() => formAction(data));
    event.target.value = "";
  };
  return (
    <div className={cards.form}>
      <label className={cards.field}>
        <span>{pending || busy ? "Saving the photo…" : "Change the photo"}</span>
        <input type="file" accept="image/*" onChange={choose} disabled={pending || busy} />
      </label>
      <Outcome state={state} />
    </div>
  );
}
