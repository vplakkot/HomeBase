"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useRef, useState } from "react";
import cards from "../../components/cards.module.css";
import { buttonClass } from "../../components/button";
import { Hint } from "../../components/hint";
import { shrinkPhoto } from "../../lib/drinks/shrink-photo";
import { MAX_IMAGES, UNNAMED_RECIPE, VIDEO_TYPES } from "../../lib/meal-plans/video-types";
import { COOKING_METHODS, MAIN_MEATS, type Ingredient, type Recipe, type RecipeDraft } from "../../lib/meal-plans/recipes";
import { rememberImports } from "../../lib/meal-plans/import-flag";
import { sendVideo } from "../../lib/meal-plans/video-upload";
import { sampleFrames } from "../../lib/meal-plans/video-still";
import {
  addRecipe,
  draftFromLink,
  draftFromPage,
  draftFromText,
  draftGeneric,
  findRecipePages,
  saveRecipeMissing,
  type PageSearch,
  dismissImport,
  saveDraft,
  setDraftPhoto,
  setRecipePhoto,
  startImagesImport,
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

// REQ-110: a card Gemini wrote from the name alone, until it's edited.
export function AiGenerated() {
  return <span className={styles.beta}>AI-generated</span>;
}

export function Beta() {
  return <span className={styles.beta}>BETA</span>;
}

// REQ-111: fields Gemini filled without being told are marked to check.
function Check() {
  return <em className={styles.unsure}> · check this</em>;
}

type Way = "video" | "images" | "link" | "web" | "text" | "blank";

const WAYS: { value: Way; label: string }[] = [
  { value: "video", label: "From a video" },
  { value: "images", label: "From images" },
  { value: "link", label: "From a recipe page link" },
  { value: "web", label: "Find it on the web" },
  { value: "text", label: "Paste or type it" },
  { value: "blank", label: "Fill in the card" },
];

// A page that couldn't be read (REQ-150): its link, a name to start
// from, and why.
type TypeIn = { url: string; name: string; why: string };

// Add recipe: pick a Source (REQ-155, a dropdown): a video (REQ-112, BETA), images (REQ-157), a recipe page link
// (REQ-150), text in any form (REQ-111), or an empty card to fill in.
export function AddRecipe() {
  const [way, setWay] = useState<Way>("video");
  const [typeIn, setTypeIn] = useState<TypeIn | null>(null);
  const choose = (next: Way) => {
    setWay(next);
    setTypeIn(null);
  };
  const cantRead = (page: TypeIn) => {
    setTypeIn(page);
    setWay("text");
  };
  return (
    <>
      <label className={cards.field}>
        <span>
          Source
          {way === "video" ? <Beta /> : null}
        </span>
        <select name="way" value={way} onChange={(event) => choose(event.target.value as Way)}>
          {WAYS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {way === "video" ? (
        <VideoForm />
      ) : way === "images" ? (
        <ImagesForm />
      ) : way === "link" ? (
        <LinkForm cantRead={cantRead} />
      ) : way === "web" ? (
        <WebForm />
      ) : way === "text" ? (
        <TextForm key={typeIn?.url ?? ""} from={typeIn} />
      ) : (
        <RecipeForm />
      )}
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
  const picker = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const picked = () => setChosen(picker.current?.files?.[0]?.name ?? null);
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
    // No name asked for: the video says what the dish is (Vin, 2026-09-29).
    data.set("name", "");
    data.set("video_url", String(form.get("video_url") ?? ""));
    data.set("size", String(file.size));
    data.set("mime", mimeOf(file));
    // REQ-156: a few frames, for Gemini to pick the card's photo from.
    for (const frame of await sampleFrames(file)) data.append("frame", frame, "frame.jpg");
    const started = await startVideoImport(data);
    if ("error" in started) {
      setError(started.error);
      setBusy(false);
      return;
    }
    rememberImports();
    upload(started.id, UNNAMED_RECIPE, started.uploadUrl, file);
    router.push("/meal-plans");
  };
  return (
    <form onSubmit={submit} className={cards.form}>
      <label className={cards.field}>
        <span className={styles.labelRow}>
          Link to the video (optional)
          <Hint text="Gemini reads the video while you do other things, and a note says when the recipe is ready, named from what it shows. Keep HomeBase open until the video has sent." />
        </span>
        <input name="video_url" type="url" inputMode="url" placeholder="https://www.instagram.com/reel/…" autoComplete="off" />
      </label>
      {/* #212: shaped like Drinks' Choose a photo, which opens the photo
          library on an iPhone: a hidden picker opened by a button. */}
      <div className={cards.field}>
        <span>The downloaded video</span>
        <input ref={picker} name="video" type="file" accept="video/*" className={styles.hidden} aria-label="The downloaded video" onChange={picked} />
        <button type="button" className={styles.linkButton} onClick={() => picker.current?.click()}>
          {chosen ?? "Choose the video"}
        </button>
      </div>
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

// REQ-157: one or more pictures that make one recipe (a carousel,
// screenshots). Each is shrunk here and sent with this request; Gemini
// reads them while we do other things, like a video.
function ImagesForm() {
  const router = useRouter();
  const picker = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const files = Array.from(picker.current?.files ?? []);
    if (files.length === 0) {
      setError("Choose the images.");
      return;
    }
    if (files.length > MAX_IMAGES) {
      setError(`Up to ${MAX_IMAGES} images make one recipe.`);
      return;
    }
    setBusy(true);
    setError(null);
    const data = new FormData();
    try {
      for (const file of files) {
        const shrunk = await shrinkPhoto(file);
        data.append("image", shrunk.full, "image.jpg");
        data.append("thumb", shrunk.thumb, "thumb.jpg");
      }
    } catch {
      setError("One of those couldn't be read as an image.");
      setBusy(false);
      return;
    }
    const started = await startImagesImport(data);
    if ("error" in started) {
      setError(started.error);
      setBusy(false);
      return;
    }
    rememberImports();
    router.push("/meal-plans");
  };
  return (
    <form onSubmit={submit} className={cards.form}>
      <div className={cards.field}>
        <span className={styles.labelRow}>
          The images
          <Hint text="Gemini reads the images together as one recipe while you do other things, and a note says when it is ready. The images aren't kept. If one shows the finished dish, it becomes the card's photo." />
        </span>
        <input
          ref={picker}
          name="images"
          type="file"
          accept="image/*"
          multiple
          className={styles.hidden}
          aria-label="The images"
          onChange={() => setChosen(picker.current?.files?.length ?? 0)}
        />
        <button type="button" className={styles.linkButton} onClick={() => picker.current?.click()}>
          {chosen === 0 ? "Choose the images" : chosen === 1 ? "1 image chosen" : `${chosen} images chosen`}
        </button>
      </div>
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

// The page's photo, shrunk like any photo we add (REQ-32), goes on the
// draft. Nothing is lost if it can't be: the card just has no photo yet.
async function keepPagePhoto(importId: string, dataUrl: string) {
  const blob = await (await fetch(dataUrl)).blob();
  const photo = await shrinkPhoto(blob);
  const data = new FormData();
  data.set("import_id", importId);
  data.set("photo", photo.full, "page.jpg");
  data.set("photo_thumb", photo.thumb, "page-thumb.jpg");
  await setDraftPhoto(data);
}

// REQ-150, flow 1: paste a recipe page's link; Gemini reads that page
// and drafts the card, named from the page. If the page can't be read,
// flow 2: switch to typing the recipe in, with the link kept.
function LinkForm({ cantRead }: { cantRead: (page: TypeIn) => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const link = String(new FormData(event.currentTarget).get("page_url") ?? "");
    setError(null);
    setBusy("Gemini is reading the page…");
    const result = await draftFromLink(link).catch(() => ({ error: "HomeBase didn't answer. Try again." }));
    if ("id" in result) {
      if (result.photo) {
        setBusy("Keeping the page's photo…");
        await keepPagePhoto(result.id, result.photo).catch(() => undefined);
      }
      router.push(`/meal-plans/drafts/${result.id}`);
      return;
    }
    setBusy(null);
    if ("typeIn" in result) cantRead({ ...result.typeIn, why: result.error });
    else setError(result.error);
  };
  return (
    <form onSubmit={submit} className={cards.form}>
      <label className={cards.field}>
        <span className={styles.labelRow}>
          Link to the recipe page
          <Hint text="Gemini reads that page only and drafts the card, with the page's photo. You check it before it's saved." />
        </span>
        <input name="page_url" type="url" inputMode="url" required placeholder="https://www.example.com/recipes/…" autoComplete="off" />
      </label>
      {error ? (
        <p role="alert" className={cards.error}>
          {error}
        </p>
      ) : null}
      <button type="submit" className={buttonClass} disabled={busy !== null}>
        {busy ?? "Read the recipe"}
      </button>
    </form>
  );
}

// REQ-112, flows 2 and 3: no video downloaded. Search the web for the
// dish, then pick a page for Gemini to read, or none: the card is then
// kept with its name and link as "Recipe missing".
function WebForm() {
  const [asked, setAsked] = useState<{ name: string; videoUrl: string } | null>(null);
  const [found, setFound] = useState<PageSearch | null>(null);
  const [searching, setSearching] = useState(false);
  const search = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const videoUrl = String(form.get("video_url") ?? "").trim();
    setAsked({ name, videoUrl });
    setSearching(true);
    setFound(await findRecipePages(name).catch(() => ({ error: "The search didn't answer. Try again." })));
    setSearching(false);
  };
  if (!found || "error" in found || !asked)
    return (
      <form onSubmit={search} className={cards.form}>
        <label className={cards.field}>
          <span>Name</span>
          <input name="name" required defaultValue={asked?.name} placeholder="What the dish is called" autoComplete="off" />
        </label>
        <label className={cards.field}>
          <span>Link to the video (optional)</span>
          <input name="video_url" type="url" inputMode="url" defaultValue={asked?.videoUrl} placeholder="https://www.instagram.com/reel/…" autoComplete="off" />
        </label>
        {found && "error" in found ? <Outcome state={found} /> : null}
        <button type="submit" className={buttonClass} disabled={searching}>
          {searching ? "Searching…" : "Search the web"}
        </button>
      </form>
    );
  return <PickPage name={asked.name} videoUrl={asked.videoUrl} pages={found.pages} suggestions={found.suggestions} again={() => setFound(null)} />;
}

function PickPage({
  name,
  videoUrl,
  pages,
  suggestions,
  again,
}: {
  name: string;
  videoUrl: string;
  pages: { url: string; site: string; title: string }[];
  suggestions: string | null;
  again: () => void;
}) {
  const [picked, pickAction, reading] = useActionState(draftFromPage, initialState);
  const [none, noneAction, saving] = useActionState(saveRecipeMissing, initialState);
  return (
    <div className={cards.form}>
      <form action={pickAction} className={styles.pickPage}>
        <input type="hidden" name="name" value={name} />
        <input type="hidden" name="video_url" value={videoUrl} />
        {pages.length > 0 ? (
          <fieldset className={styles.choices}>
            <legend>Recipe pages for “{name}”</legend>
            {pages.map((page) => (
              <label key={page.url} className={styles.pageChoice}>
                <input type="radio" name="page_url" value={page.url} required />
                <span>
                  <span className={styles.pageTitle}>{page.title}</span>
                  <span className={styles.pageSite}>{page.site}</span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          <p>No recipe pages came up for “{name}”.</p>
        )}
        {/* Google's terms: its search suggestions show with the results. */}
        {suggestions ? (
          <iframe
            title="Google search suggestions"
            srcDoc={suggestions}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            className={styles.suggestions}
          />
        ) : null}
        <Outcome state={picked} />
        {pages.length > 0 ? (
          <button type="submit" className={buttonClass} disabled={reading || saving}>
            {reading ? "Gemini is reading the page…" : "Use this page"}
          </button>
        ) : null}
      </form>
      <form action={noneAction}>
        <input type="hidden" name="name" value={name} />
        <input type="hidden" name="video_url" value={videoUrl} />
        <Outcome state={none} />
        <button type="submit" className={styles.linkButton} disabled={reading || saving}>
          None of these: save it as Recipe missing
        </button>
      </form>
      <button type="button" className={styles.linkButton} onClick={again}>
        Search again
      </button>
    </div>
  );
}

// REQ-112, flow 3: a "Recipe missing" card asks Gemini for a generic
// version, reviewed before it's saved.
export function GenericRecipeForm({ recipeId }: { recipeId: string }) {
  const [state, formAction, pending] = useActionState(draftGeneric, initialState);
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={recipeId} />
      <Outcome state={state} />
      <button type="submit" className={buttonClass} disabled={pending}>
        {pending ? "Gemini is writing one…" : "Have Gemini write one"}
      </button>
    </form>
  );
}

function TextForm({ from = null }: { from?: TypeIn | null }) {
  const [state, formAction, pending] = useActionState(draftFromText, initialState);
  return (
    <form action={formAction} className={cards.form}>
      {from ? (
        <>
          <p role="alert" className={cards.error}>
            {from.why}
          </p>
          <input type="hidden" name="page_url" value={from.url} />
          <p className={styles.pageKept}>
            Link kept:{" "}
            <a href={from.url} target="_blank" rel="noopener noreferrer">
              {from.url}
            </a>
          </p>
        </>
      ) : null}
      <label className={cards.field}>
        <span>Name</span>
        <input name="name" required defaultValue={from?.name} placeholder="What the dish is called" autoComplete="off" />
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
  pageUrl,
  cuisines = [],
  frames,
}: {
  recipe?: Recipe;
  draft?: RecipeDraft;
  importId?: string;
  name?: string;
  videoUrl?: string | null;
  pageUrl?: string | null;
  cuisines?: readonly string[];
  // REQ-156: a video's candidate photos (empty: none qualified).
  frames?: { n: number; url: string }[];
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
      {frames ? (
        <fieldset className={styles.frames}>
          <legend>Photo</legend>
          {frames.length === 0 ? (
            <p>No frame of the video showed the finished dish clearly, so this card will have no photo. You can add your own after saving.</p>
          ) : (
            <div className={styles.frameRow}>
              {frames.map((frame, index) => (
                <label key={frame.n} className={styles.frameChoice}>
                  <input type="radio" name="frame" value={frame.n} defaultChecked={index === 0} />
                  {/* eslint-disable-next-line @next/next/no-img-element -- a private, short-lived link */}
                  <img src={frame.url} alt={`Photo choice ${index + 1}`} />
                </label>
              ))}
              <label className={`${styles.frameChoice} ${styles.noFrame}`}>
                <input type="radio" name="frame" value="" />
                <span>No photo</span>
              </label>
            </div>
          )}
        </fieldset>
      ) : null}
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
          <input name="page_url" type="url" inputMode="url" defaultValue={recipe?.page_url ?? pageUrl ?? ""} autoComplete="off" />
        </label>
      </div>
      <Outcome state={state} />
      <div className={cards.actions}>
        <button type="submit" className={buttonClass} disabled={pending}>
          {pending ? "Saving…" : importId ? "Save recipe" : recipe ? "Save changes" : "Save recipe"}
        </button>
        {importId ? (
          // REQ-155: a draft's Cancel throws the draft away, so Save and
          // Cancel are the only actions at its end.
          <button type="submit" formAction={dismissImport} formNoValidate name="id" value={importId} className={styles.linkButton}>
            Cancel
          </button>
        ) : (
          <Link href={recipe ? `/meal-plans/${recipe.id}` : "/meal-plans"}>Cancel</Link>
        )}
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
