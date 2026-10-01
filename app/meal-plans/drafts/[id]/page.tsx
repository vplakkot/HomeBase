import { notFound } from "next/navigation";
import { signedPhotoLinks } from "../../../../lib/drinks/photos";
import { RECIPE_PHOTOS } from "../../../../lib/meal-plans/photos";
import { framePath, readFrames } from "../../../../lib/meal-plans/frames";
import { readCuisines, readImport } from "../../../../lib/meal-plans/recipes";
import { dismissImport } from "../../actions";
import { MealPlansScreen, mealPlansViewer } from "../../frame";
import { AiGenerated, Beta, RecipeForm } from "../../forms";
import styles from "../../meal-plans.module.css";

const UUID = /^[0-9a-f-]{36}$/i;

// A draft card to review before it's saved (REQ-111, REQ-112). While a
// video is still on its way this says so; if Gemini couldn't read it,
// it says that plainly and offers the card to fill in by hand instead.
export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const viewer = await mealPlansViewer();
  const draft = await readImport(viewer.supabase, id);
  if (!draft) notFound();
  const cuisines = await readCuisines(viewer.supabase);
  const photo = draft.photo ? (await signedPhotoLinks(viewer.supabase, [draft.photo], 60 * 60, RECIPE_PHOTOS)).get(draft.photo) : undefined;
  // BETA marks only the video path (REQ-112): a draft read from a page,
  // or Gemini's generic version, may carry a video link without being one.
  // Drafts made before `source` existed are told by their link or photo.
  const fromVideo =
    draft.source
      ? draft.source === "video"
      : !draft.page_url && !draft.ai_generated && (draft.video_url !== null || draft.photo !== null || draft.status !== "ready");
  // REQ-156: a video's candidate photos, once it has been read.
  const frameNumbers = fromVideo && draft.status === "ready" ? await readFrames(viewer.supabase, draft.id) : [];
  const frameLinks = await signedPhotoLinks(viewer.supabase, frameNumbers.map((n) => framePath(draft.id, n)), 60 * 60, RECIPE_PHOTOS);
  const frames = frameNumbers.flatMap((n) => {
    const url = frameLinks.get(framePath(draft.id, n));
    return url ? [{ n, url }] : [];
  });
  return (
    <MealPlansScreen viewer={viewer} section="Recipes" crumb={draft.name}>
      <section className={styles.formCard} aria-label="Review the recipe">
        <h2 className={styles.title}>
          {draft.name}
          {fromVideo ? <Beta /> : null}
          {draft.ai_generated ? <AiGenerated /> : null}
        </h2>
        {photo ? <img src={photo} alt="" className={styles.hero} /> : null}
        {draft.status === "uploading" || draft.status === "processing" ? (
          <div className={styles.notice}>
            <p>{draft.status === "uploading" ? "The video is still sending." : `Gemini is reading ${draft.source === "images" ? "the images" : "the video"}.`}</p>
            <div className={styles.progress} />
          </div>
        ) : null}
        {draft.status === "failed" ? (
          <div className={styles.notice} role="alert">
            <p>Gemini couldn&apos;t read a recipe from {draft.source === "images" ? "these images" : "this video"}. {draft.error}</p>
            <p>Fill the card in below, or remove it.</p>
          </div>
        ) : null}
        {draft.status === "ready" || draft.status === "failed" ? (
          <RecipeForm
            importId={draft.id}
            draft={draft.draft ?? undefined}
            name={draft.name}
            videoUrl={draft.video_url}
            pageUrl={draft.page_url}
            cuisines={cuisines}
            frames={fromVideo && draft.status === "ready" && !draft.photo ? frames : undefined}
            noFrame={
              draft.photo_at === null
                ? "Gemini found no moment in the video that shows the finished dish clearly, so this card will have no photo. You can add your own after saving."
                : "The photo couldn't be taken from the video, because HomeBase wasn't open on the phone that sent it when the recipe was ready. You can add your own after saving."
            }
          />
        ) : null}
        {draft.status === "uploading" || draft.status === "processing" ? (
          <form action={dismissImport}>
            <input type="hidden" name="id" value={draft.id} />
            <button type="submit" className={styles.linkButton}>
              Remove this draft
            </button>
          </form>
        ) : null}
      </section>
    </MealPlansScreen>
  );
}
