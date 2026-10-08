"use server";

import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { hasPermission } from "../../lib/auth/permissions";
import { thumbPath } from "../../lib/drinks/photos";
import {
  deleteVideo,
  genericRecipe,
  isGeminiFile,
  openVideoUpload,
  recipeFromPage,
  recipeFromText,
  searchRecipePages,
  uploadProgress,
} from "../../lib/meal-plans/gemini";
import { isPublicPage, readImage, readPage, readRecipePage, titleFrom, type SearchResult } from "../../lib/meal-plans/recipe-search";
import { MAX_CAPTION_IMAGES, MAX_CAPTION_TEXT, MAX_IMAGES, MAX_IMAGES_BYTES, MAX_VIDEO_BYTES, UNNAMED_IMAGES, UNNAMED_RECIPE, VIDEO_TYPES } from "../../lib/meal-plans/video-types";
import { createNameOnly } from "../../lib/meal-plans/name-only";
import { framePath, removeFrames } from "../../lib/meal-plans/frames";
import { PROCESSING_GIVES_UP_MS, UPLOAD_GIVES_UP_MS, processImageImport, processVideoImport } from "../../lib/meal-plans/import-job";
import { RECIPE_PHOTOS, recipePhotoPath } from "../../lib/meal-plans/photos";
import { linkOrNull, readImports, recipeFieldsFrom, recipeMissing, type RecipeImport } from "../../lib/meal-plans/recipes";
import { createAdminClient } from "../../lib/supabase/admin";
import { createClient } from "../../lib/supabase/server";

export type FormState = { error?: string; saved?: boolean };

const UUID = /^[0-9a-f-]{36}$/i;
// A row's own person can change it directly in the database, so the
// upload link read back from one is checked before the server calls it.
const UPLOAD_LINK = "https://generativelanguage.googleapis.com/upload/";
const MAX_PHOTO_UPLOAD = 1024 * 1024;
const MAX_RECIPE_TEXT = 20_000;

async function requireMember() {
  const supabase = await createClient();
  if (!(await hasPermission(supabase, "use_modules"))) redirect("/meal-plans");
  return supabase;
}

function idFrom(value: unknown): string | null {
  const id = String(value ?? "").trim();
  return UUID.test(id) ? id : null;
}

function refresh() {
  revalidatePath("/meal-plans", "layout");
  revalidatePath("/");
}

// A photo from a form: a JPEG the browser already shrank, and its small copy.
function photoFrom(formData: FormData): { full: Blob; thumb: Blob } | null | { error: string } {
  const full = formData.get("photo");
  const thumb = formData.get("photo_thumb");
  if (!(full instanceof Blob) || full.size === 0) return null;
  if (!(thumb instanceof Blob) || thumb.size === 0) return { error: "The photo's small copy is missing. Try again." };
  if (full.type !== "image/jpeg" || thumb.type !== "image/jpeg") return { error: "Photos are sent as JPEG." };
  if (full.size > MAX_PHOTO_UPLOAD || thumb.size > MAX_PHOTO_UPLOAD) return { error: "That photo is too big. Try again." };
  return { full, thumb };
}

async function storePhoto(supabase: SupabaseClient, owner: string, photo: { full: Blob; thumb: Blob }): Promise<string> {
  const path = recipePhotoPath(owner);
  const bucket = supabase.storage.from(RECIPE_PHOTOS);
  for (const [where, blob] of [
    [path, photo.full],
    [thumbPath(path), photo.thumb],
  ] as const) {
    const { error } = await bucket.upload(where, blob, { contentType: "image/jpeg" });
    if (error) throw new Error(`Could not store the photo: ${error.message}`);
  }
  return path;
}

async function removePhoto(supabase: SupabaseClient, path: string | null) {
  if (path) await supabase.storage.from(RECIPE_PHOTOS).remove([path, thumbPath(path)]);
}

// REQ-110: a cuisine the list doesn't have yet joins it the first time a
// recipe needs it.
async function keepCuisine(supabase: SupabaseClient, cuisine: string | null) {
  if (!cuisine) return;
  const { error } = await supabase.from("cuisines").upsert({ name: cuisine }, { onConflict: "name", ignoreDuplicates: true });
  if (error) throw new Error(`Could not add the cuisine: ${error.message}`);
}

// REQ-174: "Add details" on a "Recipe missing" card fills that same card,
// so its ratings and cooked history stay. A draft carries the card's id; the
// card must still be waiting for its recipe. No id means a new card.
async function fillTarget(supabase: SupabaseClient, value: unknown): Promise<{ recipeId: string | null } | { error: string }> {
  if (!String(value ?? "").trim()) return { recipeId: null };
  const id = idFrom(value);
  if (!id) return { error: "That recipe is gone." };
  const { data: card } = await supabase.from("recipes").select("ingredients, steps").eq("id", id).maybeSingle();
  if (!card) return { error: "That recipe is gone." };
  if (!recipeMissing(card)) return { error: "That card has a recipe now. Edit it instead." };
  return { recipeId: id };
}

// REQ-174: Add recipe starts with the name, and Save for now keeps just
// that: a card marked "Recipe missing", no review step. Gemini names a
// cuisine from the name alone only when it is confident ("Tacos" is
// Mexican); otherwise the cuisine stays blank. It never writes a recipe
// here, and if it doesn't answer the card is saved without one.
export async function saveForNow(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Give the recipe a name." };
  // What was typed so far is kept too: a recipe page link and a video link.
  const videoText = String(formData.get("video_url") ?? "").trim();
  const video_url = linkOrNull(videoText);
  if (videoText && !video_url) return { error: "The video link should start with https://." };
  const pageText = String(formData.get("page_url") ?? "").trim();
  const page_url = pageText && isPublicPage(pageText) ? pageText : null;
  if (pageText && !page_url) return { error: "The recipe page link should start with https://." };
  const made = await createNameOnly(supabase, name, { video_url, page_url });
  if ("error" in made) return { error: made.error };
  const { id } = made;
  refresh();
  redirect(`/meal-plans/${id}`);
}

// REQ-111: a recipe in any form becomes a draft card to review. It's
// quick, so it happens while the button shows it's working.
export async function draftFromText(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const name = String(formData.get("name") ?? "").trim();
  const recipe = String(formData.get("recipe") ?? "").trim();
  if (!name) return { error: "Give the recipe a name." };
  if (!recipe) return { error: "Paste or type the recipe." };
  if (recipe.length > MAX_RECIPE_TEXT) return { error: "That's longer than a recipe. Paste just the recipe." };
  const target = await fillTarget(supabase, formData.get("recipe_id"));
  if ("error" in target) return target;
  const reading = await recipeFromText(name, recipe).catch((error: unknown) => {
    Sentry.captureException(error);
    return { error: "Gemini didn't answer." };
  });
  if ("error" in reading) return { error: `${reading.error} Try again, or fill the card in yourself.` };
  const id = crypto.randomUUID();
  // REQ-150: a recipe typed in from a page that couldn't be read keeps
  // that page's link.
  const page_url = isPublicPage(formData.get("page_url")) ? String(formData.get("page_url")) : null;
  const { error } = await supabase.from("recipe_imports").insert({
    id,
    name,
    status: "ready",
    draft: reading.draft,
    seen: true,
    video_url: linkOrNull(formData.get("video_url")),
    page_url,
    recipe_id: target.recipeId,
  });
  if (error) return { error: "The draft couldn't be kept. Try again." };
  redirect(`/meal-plans/drafts/${id}`);
}

export type LinkDraft =
  | { id: string; photo: string | null }
  // The page couldn't be read, or has no recipe: type it in instead,
  // with the link kept and a name to start from.
  | { error: string; typeIn: { url: string; name: string } }
  | { error: string };

// REQ-150: a pasted recipe page link becomes a draft card, read from
// that page only; its name comes from the page. The page's photo comes
// back as a data: address for the browser to shrink and keep (the
// bucket takes only small JPEGs, and shrinking happens in the browser).
export async function draftFromLink(link: string, recipeId?: string): Promise<LinkDraft> {
  const supabase = await requireMember();
  const url = link.trim();
  const target = await fillTarget(supabase, recipeId);
  if ("error" in target) return target;
  if (!isPublicPage(url)) return { error: "Paste the recipe page's link, starting with https://." };
  const typeIn = { url, name: titleFrom(url) };
  let page: { text: string; image: string | null };
  try {
    page = await readRecipePage(url);
  } catch {
    return { error: "That page couldn't be read. Copy the recipe from the site and paste it here.", typeIn };
  }
  if (!page.text) return { error: "That page has nothing to read. Copy the recipe from the site and paste it here.", typeIn };
  const reading = await recipeFromPage("", page.text).catch((error: unknown) => {
    Sentry.captureException(error);
    return null;
  });
  if (!reading) return { error: "Gemini didn't answer. Try again." };
  if ("error" in reading) {
    if (!reading.error.includes("no recipe")) return { error: `${reading.error} Try again.` };
    return { error: "Gemini found no recipe on that page. Copy it from the site and paste it here.", typeIn };
  }
  const name = reading.draft.name || typeIn.name;
  const id = crypto.randomUUID();
  const { error } = await supabase
    .from("recipe_imports")
    .insert({ id, name, status: "ready", draft: { ...reading.draft, name }, seen: true, page_url: url, recipe_id: target.recipeId });
  if (error) return { error: "The draft couldn't be kept. Try again." };
  // A missing or unreadable photo doesn't stop the card.
  const photo = page.image ? await readImage(page.image).catch(() => null) : null;
  return { id, photo };
}

// REQ-150: the page's photo, shrunk by the browser, goes on the draft
// that has none yet; saving the draft makes it the card's photo.
export async function setDraftPhoto(formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = idFrom(formData.get("import_id"));
  if (!id) return { error: "That draft is gone." };
  const photo = photoFrom(formData);
  if (!photo) return { error: "Choose a photo first." };
  if ("error" in photo) return photo;
  const { data: draft } = await supabase.from("recipe_imports").select("photo").eq("id", id).maybeSingle();
  if (!draft) return { error: "That draft is gone." };
  if (draft.photo) return { saved: true };
  let path: string | null = null;
  try {
    path = await storePhoto(supabase, `imports/${id}`, photo);
    const { error } = await supabase.from("recipe_imports").update({ photo: path }).eq("id", id);
    if (error) throw new Error(error.message);
  } catch (error) {
    Sentry.captureException(error);
    await removePhoto(supabase, path);
    return { error: "The photo couldn't be kept." };
  }
  return { saved: true };
}

export type VideoStart = { id: string; uploadUrl: string } | { error: string };

// REQ-112 (BETA): the first half of adding from a video. Keeps the name
// and link and opens the one-time upload link the phone sends the video
// to. The video itself never passes through here.
export async function startVideoImport(formData: FormData): Promise<VideoStart> {
  const supabase = await requireMember();
  const name = String(formData.get("name") ?? "").trim() || UNNAMED_RECIPE;
  const size = Number(formData.get("size"));
  const mime = String(formData.get("mime") ?? "");
  const linkText = String(formData.get("video_url") ?? "").trim();
  const video_url = linkOrNull(linkText);
  if (linkText && !video_url) return { error: "The video link should start with https://." };
  if (!VIDEO_TYPES[mime]) return { error: "That file isn't a video HomeBase can send." };
  if (!Number.isInteger(size) || size <= 0) return { error: "That video looks empty." };
  if (size > MAX_VIDEO_BYTES) return { error: "That video is over 500 MB. Try a shorter one." };
  const target = await fillTarget(supabase, formData.get("recipe_id"));
  if ("error" in target) return target;
  const caption = await captionFromForm(formData);
  if ("error" in caption) return caption;
  const id = crypto.randomUUID();
  try {
    const uploadUrl = await openVideoUpload(size, mime, name);
    const { error } = await supabase
      .from("recipe_imports")
      .insert({ id, name, video_url, source: "video", status: "uploading", upload_url: uploadUrl, recipe_id: target.recipeId, ...caption });
    if (error) throw new Error(error.message);
    return { id, uploadUrl };
  } catch (error) {
    Sentry.captureException(error);
    return { error: "The upload couldn't start. Try again." };
  }
}

// REQ-182: the caption sent with a video: pasted text and up to 2 shrunk
// screenshots. Kept on the import only until Gemini has read them.
async function captionFromForm(formData: FormData): Promise<{ caption_text: string | null; caption_images: { mime: string; data: string }[] | null } | { error: string }> {
  const text = String(formData.get("caption_text") ?? "").trim();
  if (text.length > MAX_CAPTION_TEXT) return { error: "That caption is too long. Keep just the recipe part." };
  const files = formData.getAll("caption_image");
  if (files.length > MAX_CAPTION_IMAGES) return { error: `Up to ${MAX_CAPTION_IMAGES} caption screenshots.` };
  const blobs = files.filter((item): item is File => item instanceof File && item.size > 0);
  if (blobs.length !== files.length) return { error: "A caption screenshot didn't arrive. Try again." };
  if (blobs.some((blob) => blob.type !== "image/jpeg" || blob.size > MAX_PHOTO_UPLOAD)) return { error: "Screenshots are sent as JPEG, under 1 MB each." };
  const images = await Promise.all(blobs.map(async (blob) => ({ mime: "image/jpeg", data: Buffer.from(await blob.arrayBuffer()).toString("base64") })));
  return { caption_text: text || null, caption_images: images.length > 0 ? images : null };
}

export type ImagesStart = { id: string } | { error: string };

// REQ-157: adding from pictures. They're small once the phone has shrunk
// them, so they come with this request, are read after it answers (the
// "On their way" toast reports back, as for a video), and are never kept.
// Each picture comes with its small copy, for the one that may become the
// card's photo.
export async function startImagesImport(formData: FormData): Promise<ImagesStart> {
  const supabase = await requireMember();
  const pictures = formData.getAll("image");
  const smalls = formData.getAll("thumb");
  if (pictures.length === 0) return { error: "Choose at least one image." };
  if (pictures.length > MAX_IMAGES) return { error: `Up to ${MAX_IMAGES} images make one recipe.` };
  const blobs = pictures.filter((item): item is File => item instanceof File && item.size > 0);
  const thumbs = smalls.filter((item): item is File => item instanceof File && item.size > 0);
  if (blobs.length !== pictures.length || thumbs.length !== pictures.length) return { error: "An image didn't arrive. Try again." };
  if ([...blobs, ...thumbs].some((blob) => blob.type !== "image/jpeg" || blob.size > MAX_PHOTO_UPLOAD)) return { error: "Images are sent as JPEG, under 1 MB each." };
  if ([...blobs, ...thumbs].reduce((sum, blob) => sum + blob.size, 0) > MAX_IMAGES_BYTES) return { error: "Those images are too big together. Try fewer." };
  const target = await fillTarget(supabase, formData.get("recipe_id"));
  if ("error" in target) return target;
  const id = crypto.randomUUID();
  const { error } = await supabase.from("recipe_imports").insert({ id, name: UNNAMED_IMAGES, source: "images", status: "processing", recipe_id: target.recipeId });
  if (error) {
    Sentry.captureException(error);
    return { error: "The import couldn't start. Try again." };
  }
  const images = await Promise.all(blobs.map(async (blob) => ({ mime: "image/jpeg", data: Buffer.from(await blob.arrayBuffer()).toString("base64") })));
  after(async () => {
    try {
      const admin = createAdminClient();
      await processImageImport(admin, id, images, {
        keepPhoto: (index) => storePhoto(admin, `imports/${id}`, { full: blobs[index], thumb: thumbs[index] }),
      });
    } catch (problem) {
      Sentry.captureException(problem);
    }
  });
  return { id };
}

// REQ-156: Gemini named the second of the video for the photo; the phone
// that still has the video cut that frame and sends it here, to wait
// beside the draft until it's saved.
export async function setDraftFrame(formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = idFrom(formData.get("import_id"));
  const frame = formData.get("frame");
  if (!id) return { error: "That draft is gone." };
  if (!(frame instanceof File) || frame.size === 0) return { error: "No frame came with it." };
  if (frame.type !== "image/jpeg" || frame.size > MAX_PHOTO_UPLOAD) return { error: "That frame can't be used." };
  const { data: draft } = await supabase.from("recipe_imports").select("id, source").eq("id", id).maybeSingle();
  if (!draft || draft.source !== "video") return { error: "That draft is gone." };
  const bucket = supabase.storage.from(RECIPE_PHOTOS);
  const path = framePath(id, 1);
  for (const where of [path, thumbPath(path)]) {
    const { error } = await bucket.upload(where, frame, { contentType: "image/jpeg", upsert: true });
    if (error) {
      Sentry.captureException(error);
      return { error: "The photo couldn't be kept." };
    }
  }
  return { saved: true };
}

export type VideoProgress = { done: true } | { received: number } | { error: string };

// The phone asks after its last piece, or after a piece failed: how much
// of the video has Google got? Once it has all of it, the import moves to
// processing and reading carries on after this answers (the second half
// of adding from a video).
export async function videoProgress(id: string): Promise<VideoProgress> {
  const supabase = await requireMember();
  const importId = idFrom(id);
  if (!importId) return { error: "That upload isn't one of ours." };
  const { data: row } = await supabase
    .from("recipe_imports")
    .select("upload_url, status")
    .eq("id", importId)
    .maybeSingle();
  if (!row?.upload_url?.startsWith(UPLOAD_LINK) || row.status !== "uploading") return { error: "That upload isn't one of ours." };
  const progress = await uploadProgress(row.upload_url);
  if (!progress.final) return { received: progress.received };
  if (!isGeminiFile(progress.file)) return { error: "That upload isn't one of ours." };
  const { data, error } = await supabase
    .from("recipe_imports")
    .update({ status: "processing", gemini_file: progress.file, upload_url: null, updated_at: new Date().toISOString() })
    .eq("id", importId)
    .eq("status", "uploading")
    .select("id");
  if (error || !data || data.length === 0) return { error: "That upload isn't one of ours." };
  after(async () => {
    try {
      await processVideoImport(createAdminClient(), importId);
    } catch (problem) {
      Sentry.captureException(problem);
    }
  });
  return { done: true };
}

// The phone gave up on an upload (or it was cancelled).
export async function uploadFailed(id: string): Promise<void> {
  const supabase = await requireMember();
  const importId = idFrom(id);
  if (!importId) return;
  await supabase
    .from("recipe_imports")
    .update({ status: "failed", error: "The upload didn't finish.", upload_url: null, caption_text: null, caption_images: null, updated_at: new Date().toISOString() })
    .eq("id", importId)
    .eq("status", "uploading");
}

// What the toast watches: the signed-in person's imports still going or
// not yet seen. One stuck too long becomes a failure here.
// Null when it couldn't be asked (not signed in, or the read failed): not
// the same as having no imports, which would let the phone drop videos it
// still needs for their photos (REQ-156).
export async function myRecipeImports(): Promise<RecipeImport[] | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return null;
  const imports = await readImports(supabase).catch(() => null);
  if (!imports) return null;
  const now = Date.now();
  for (const item of imports) {
    // Age in its current step: processing counts from when the upload
    // finished, not from when it started.
    const age = now - Date.parse(item.updated_at);
    const lost =
      (item.status === "processing" && age > PROCESSING_GIVES_UP_MS) || (item.status === "uploading" && age > UPLOAD_GIVES_UP_MS);
    if (lost) {
      const was = item.status;
      item.status = "failed";
      item.error = "It stopped before finishing.";
      await supabase
        .from("recipe_imports")
        .update({ status: "failed", error: item.error, upload_url: null, caption_text: null, caption_images: null, updated_at: new Date().toISOString() })
        .eq("id", item.id)
        .eq("status", was);
    }
  }
  return imports.filter((item) => !item.seen || item.status === "uploading" || item.status === "processing");
}

export async function markImportSeen(id: string): Promise<void> {
  const supabase = await createClient();
  const importId = idFrom(id);
  if (importId) await supabase.from("recipe_imports").update({ seen: true }).eq("id", importId);
}

// Throws a draft away: its still and, if Google still has it, the video.
export async function dismissImport(formData: FormData): Promise<void> {
  const supabase = await requireMember();
  const importId = idFrom(formData.get("id"));
  if (!importId) return;
  const { data } = await supabase.from("recipe_imports").select("photo, gemini_file").eq("id", importId).maybeSingle();
  await supabase.from("recipe_imports").delete().eq("id", importId);
  if (isGeminiFile(data?.gemini_file)) await deleteVideo(data.gemini_file);
  await removePhoto(supabase, data?.photo ?? null);
  await removeFrames(supabase, importId);
  refresh();
  if (formData.get("stay") !== "yes") redirect("/meal-plans");
}

// REQ-110, REQ-111, REQ-112: the reviewed draft becomes a recipe card.
// A video's still becomes its photo, and the draft is gone.
export async function saveDraft(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const importId = idFrom(formData.get("import_id"));
  if (!importId) return { error: "That draft is gone." };
  const fields = recipeFieldsFrom(formData);
  if ("error" in fields) return fields;
  const { data: draft } = await supabase
    .from("recipe_imports")
    .select("photo, recipe_id, ai_generated")
    .eq("id", importId)
    .maybeSingle();
  if (!draft) return { error: "That draft is gone." };
  // REQ-112: Gemini's generic version fills in the "Recipe missing" card
  // it was asked for; any other draft becomes a new card.
  const id = idFrom(draft.recipe_id) ?? crypto.randomUUID();
  const ai_generated = draft.ai_generated === true;
  let fillPhoto: string | null = null;
  // The card must still be waiting for its recipe: if either of us typed
  // one in meanwhile, the generic version doesn't overwrite it.
  if (draft.recipe_id) {
    const { data: card } = await supabase.from("recipes").select("ingredients, steps, photo").eq("id", id).maybeSingle();
    if (!card) return { error: "That recipe is gone. Remove this draft." };
    if (!recipeMissing(card)) return { error: "That card has a recipe now. Remove this draft, or edit the card instead." };
    // REQ-174: a card with no photo takes the draft's (a page's or an image's).
    if (!card.photo && draft.photo) fillPhoto = draft.photo;
  }
  // REQ-156: the frame chosen at review becomes the card's photo, and no
  // frame is a card with none.
  const frame = Number(formData.get("frame"));
  let photo: string | null = draft.photo ?? null;
  if (!draft.recipe_id && Number.isInteger(frame) && frame >= 1) {
    const from = framePath(importId, frame);
    const to = recipePhotoPath(`imports/${importId}`);
    const bucket = supabase.storage.from(RECIPE_PHOTOS);
    const copied = await bucket.copy(from, to);
    const thumbCopied = copied.error ? copied : await bucket.copy(thumbPath(from), thumbPath(to));
    if (copied.error || thumbCopied.error) {
      Sentry.captureException(copied.error ?? thumbCopied.error);
      await removePhoto(supabase, copied.error ? null : to);
      return { error: "That photo couldn't be kept. Try again, or choose no photo." };
    }
    photo = to;
  }
  try {
    await keepCuisine(supabase, fields.cuisine);
    const { error } = draft.recipe_id
      ? await supabase.from("recipes").update({ ...fields, ai_generated, ...(fillPhoto ? { photo: fillPhoto } : {}) }).eq("id", id)
      : await supabase.from("recipes").insert({ id, ...fields, ai_generated, photo });
    if (error) throw new Error(error.message);
  } catch (error) {
    Sentry.captureException(error);
    // The copy made for this save isn't needed if it didn't happen.
    if (photo !== (draft.photo ?? null)) await removePhoto(supabase, photo);
    return { error: "The recipe couldn't be saved. Try again." };
  }
  await supabase.from("recipe_imports").delete().eq("id", importId);
  await removeFrames(supabase, importId);
  refresh();
  redirect(`/meal-plans/${id}`);
}

// A card filled in by hand, when Gemini isn't wanted or didn't answer.
export async function addRecipe(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const fields = recipeFieldsFrom(formData);
  if ("error" in fields) return fields;
  const id = crypto.randomUUID();
  try {
    await keepCuisine(supabase, fields.cuisine);
    const { error } = await supabase.from("recipes").insert({ id, ...fields });
    if (error) throw new Error(error.message);
  } catch (error) {
    Sentry.captureException(error);
    return { error: "The recipe couldn't be saved. Try again." };
  }
  refresh();
  redirect(`/meal-plans/${id}`);
}

export async function updateRecipe(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = idFrom(formData.get("id"));
  if (!id) return { error: "That recipe is gone." };
  const fields = recipeFieldsFrom(formData);
  if ("error" in fields) return fields;
  try {
    await keepCuisine(supabase, fields.cuisine);
    // REQ-110: "AI-generated" lasts until either of us edits the card.
    const { error } = await supabase.from("recipes").update({ ...fields, ai_generated: false }).eq("id", id);
    if (error) throw new Error(error.message);
  } catch (error) {
    Sentry.captureException(error);
    return { error: "The changes couldn't be saved. Try again." };
  }
  refresh();
  redirect(`/meal-plans/${id}`);
}

const MAX_NOTE = 2000;

// REQ-181: a note added straight from the open card, on a new line after
// the notes already there. Nothing else on the card is touched.
export async function addRecipeNote(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = idFrom(formData.get("id"));
  if (!id) return { error: "That recipe is gone." };
  const note = String(formData.get("note") ?? "").trim();
  if (!note) return { error: "Type the note first." };
  if (note.length > MAX_NOTE) return { error: `Keep a note to ${MAX_NOTE} letters or fewer.` };
  try {
    const { data: recipe, error: readError } = await supabase.from("recipes").select("notes").eq("id", id).maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!recipe) return { error: "That recipe is gone." };
    const notes = recipe.notes ? `${recipe.notes}\n${note}` : note;
    const { error } = await supabase.from("recipes").update({ notes }).eq("id", id);
    if (error) throw new Error(error.message);
  } catch (error) {
    Sentry.captureException(error);
    return { error: "The note couldn't be saved. Try again." };
  }
  refresh();
  return { saved: true };
}

// REQ-110: either of us can replace the photo with our own.
export async function setRecipePhoto(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = idFrom(formData.get("id"));
  if (!id) return { error: "That recipe is gone." };
  const photo = photoFrom(formData);
  if (!photo) return { error: "Choose a photo first." };
  if ("error" in photo) return photo;
  const { data: recipe } = await supabase.from("recipes").select("photo").eq("id", id).maybeSingle();
  if (!recipe) return { error: "That recipe is gone." };
  try {
    const path = await storePhoto(supabase, id, photo);
    const { error } = await supabase.from("recipes").update({ photo: path }).eq("id", id);
    if (error) throw new Error(error.message);
  } catch (error) {
    Sentry.captureException(error);
    return { error: "The photo couldn't be saved. Try again." };
  }
  await removePhoto(supabase, recipe.photo);
  refresh();
  return { saved: true };
}

// Nothing is ever stuck: a recipe added by mistake can go.
export async function removeRecipe(formData: FormData): Promise<void> {
  const supabase = await requireMember();
  const id = idFrom(formData.get("id"));
  if (!id) return;
  const { data } = await supabase.from("recipes").select("photo").eq("id", id).maybeSingle();
  const { error } = await supabase.from("recipes").delete().eq("id", id);
  if (!error) await removePhoto(supabase, data?.photo ?? null);
  refresh();
  redirect("/meal-plans");
}

export type PageSearch = SearchResult | { error: string };

// REQ-112, flow 2: recipe pages for a dish, found by Gemini's Google
// Search. Nothing is picked for us; the pages are offered to choose from.
export async function findRecipePages(name: string): Promise<PageSearch> {
  await requireMember();
  const dish = name.trim();
  if (!dish) return { error: "Give the recipe a name." };
  const found = await searchRecipePages(dish.slice(0, 200)).catch((error: unknown) => {
    Sentry.captureException(error);
    return { error: "Gemini didn't answer." };
  });
  if ("error" in found) return { error: `${found.error} Try again, or add it without a recipe.` };
  return found;
}

// REQ-112, flow 2: the page we picked becomes a draft card, read from
// that page only, with its link kept. A page that can't be read, or has
// no recipe, is said so plainly; Gemini never makes one up instead.
export async function draftFromPage(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const name = String(formData.get("name") ?? "").trim();
  const page = String(formData.get("page_url") ?? "");
  const videoText = String(formData.get("video_url") ?? "").trim();
  const video_url = linkOrNull(videoText);
  if (!name) return { error: "Give the recipe a name." };
  if (videoText && !video_url) return { error: "The video link should start with https://." };
  if (!isPublicPage(page)) return { error: "Pick one of the pages, or choose None of these." };
  const target = await fillTarget(supabase, formData.get("recipe_id"));
  if ("error" in target) return target;
  let text: string;
  try {
    text = await readPage(page);
  } catch {
    return { error: "That page couldn't be opened. Pick another, or choose None of these." };
  }
  if (!text) return { error: "That page has nothing to read. Pick another, or choose None of these." };
  const reading = await recipeFromPage(name, text).catch((error: unknown) => {
    Sentry.captureException(error);
    return { error: "Gemini didn't answer." };
  });
  if ("error" in reading) return { error: `${reading.error} Pick another page, or choose None of these.` };
  const id = crypto.randomUUID();
  const { error } = await supabase
    .from("recipe_imports")
    .insert({ id, name, status: "ready", draft: reading.draft, seen: true, video_url, page_url: page, recipe_id: target.recipeId });
  if (error) return { error: "The draft couldn't be kept. Try again." };
  redirect(`/meal-plans/drafts/${id}`);
}

// REQ-112, flow 3: none of the pages will do, so the card is kept with
// its name and video link, and shows "Recipe missing" until it has one.
export async function saveRecipeMissing(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const name = String(formData.get("name") ?? "").trim();
  const videoText = String(formData.get("video_url") ?? "").trim();
  const video_url = linkOrNull(videoText);
  if (!name) return { error: "Give the recipe a name." };
  if (videoText && !video_url) return { error: "The video link should start with https://." };
  const id = crypto.randomUUID();
  const { error } = await supabase.from("recipes").insert({ id, name, video_url });
  if (error) {
    Sentry.captureException(new Error(error.message));
    return { error: "The card couldn't be saved. Try again." };
  }
  refresh();
  redirect(`/meal-plans/${id}`);
}

// REQ-112, flow 3: for a "Recipe missing" card, Gemini writes a generic
// version from the name. It's a draft to review like any other, and the
// card shows "AI-generated" until either of us edits it.
export async function draftGeneric(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const recipeId = idFrom(formData.get("id"));
  if (!recipeId) return { error: "That recipe is gone." };
  const { data: recipe } = await supabase.from("recipes").select("name, video_url").eq("id", recipeId).maybeSingle();
  if (!recipe) return { error: "That recipe is gone." };
  const reading = await genericRecipe(recipe.name).catch((error: unknown) => {
    Sentry.captureException(error);
    return { error: "Gemini didn't answer." };
  });
  if ("error" in reading) return { error: `${reading.error} Try again, or type the recipe in.` };
  const id = crypto.randomUUID();
  const { error } = await supabase.from("recipe_imports").insert({
    id,
    name: recipe.name,
    status: "ready",
    draft: reading.draft,
    seen: true,
    video_url: recipe.video_url,
    recipe_id: recipeId,
    ai_generated: true,
  });
  if (error) return { error: "The draft couldn't be kept. Try again." };
  redirect(`/meal-plans/drafts/${id}`);
}
