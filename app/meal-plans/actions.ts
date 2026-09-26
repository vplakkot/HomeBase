"use server";

import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { hasPermission } from "../../lib/auth/permissions";
import { thumbPath } from "../../lib/drinks/photos";
import { deleteVideo, isGeminiFile, openVideoUpload, recipeFromText, uploadProgress } from "../../lib/meal-plans/gemini";
import { MAX_VIDEO_BYTES, VIDEO_TYPES } from "../../lib/meal-plans/video-types";
import { PROCESSING_GIVES_UP_MS, UPLOAD_GIVES_UP_MS, processVideoImport } from "../../lib/meal-plans/import-job";
import { RECIPE_PHOTOS, recipePhotoPath } from "../../lib/meal-plans/photos";
import { linkOrNull, readImports, recipeFieldsFrom, type RecipeImport } from "../../lib/meal-plans/recipes";
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

// REQ-111: a recipe in any form becomes a draft card to review. It's
// quick, so it happens while the button shows it's working.
export async function draftFromText(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const name = String(formData.get("name") ?? "").trim();
  const recipe = String(formData.get("recipe") ?? "").trim();
  if (!name) return { error: "Give the recipe a name." };
  if (!recipe) return { error: "Paste or type the recipe." };
  if (recipe.length > MAX_RECIPE_TEXT) return { error: "That's longer than a recipe. Paste just the recipe." };
  const reading = await recipeFromText(name, recipe).catch((error: unknown) => {
    Sentry.captureException(error);
    return { error: "Gemini didn't answer." };
  });
  if ("error" in reading) return { error: `${reading.error} Try again, or fill the card in yourself.` };
  const id = crypto.randomUUID();
  const { error } = await supabase
    .from("recipe_imports")
    .insert({ id, name, status: "ready", draft: reading.draft, seen: true, video_url: linkOrNull(formData.get("video_url")) });
  if (error) return { error: "The draft couldn't be kept. Try again." };
  redirect(`/meal-plans/drafts/${id}`);
}

export type VideoStart = { id: string; uploadUrl: string } | { error: string };

// REQ-112 (BETA): the first half of adding from a video. Keeps the name,
// link and still, and opens the one-time upload link the phone sends the
// video to. The video itself never passes through here.
export async function startVideoImport(formData: FormData): Promise<VideoStart> {
  const supabase = await requireMember();
  const name = String(formData.get("name") ?? "").trim();
  const size = Number(formData.get("size"));
  const mime = String(formData.get("mime") ?? "");
  const linkText = String(formData.get("video_url") ?? "").trim();
  const video_url = linkOrNull(linkText);
  if (!name) return { error: "Give the recipe a name." };
  if (linkText && !video_url) return { error: "The video link should start with https://." };
  if (!VIDEO_TYPES[mime]) return { error: "That file isn't a video HomeBase can send." };
  if (!Number.isInteger(size) || size <= 0) return { error: "That video looks empty." };
  if (size > MAX_VIDEO_BYTES) return { error: "That video is over 500 MB. Try a shorter one." };
  const still = photoFrom(formData);
  if (still && "error" in still) return still;
  const id = crypto.randomUUID();
  let photo: string | null = null;
  try {
    const uploadUrl = await openVideoUpload(size, mime, name);
    photo = still ? await storePhoto(supabase, `imports/${id}`, still) : null;
    const { error } = await supabase
      .from("recipe_imports")
      .insert({ id, name, video_url, photo, status: "uploading", upload_url: uploadUrl });
    if (error) throw new Error(error.message);
    return { id, uploadUrl };
  } catch (error) {
    Sentry.captureException(error);
    await removePhoto(supabase, photo);
    return { error: "The upload couldn't start. Try again." };
  }
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
    .update({ status: "failed", error: "The upload didn't finish.", upload_url: null, updated_at: new Date().toISOString() })
    .eq("id", importId)
    .eq("status", "uploading");
}

// What the toast watches: the signed-in person's imports still going or
// not yet seen. One stuck too long becomes a failure here.
export async function myRecipeImports(): Promise<RecipeImport[]> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return [];
  const imports = await readImports(supabase).catch(() => []);
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
        .update({ status: "failed", error: item.error, upload_url: null, updated_at: new Date().toISOString() })
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
  const { data: draft } = await supabase.from("recipe_imports").select("photo").eq("id", importId).maybeSingle();
  if (!draft) return { error: "That draft is gone." };
  const id = crypto.randomUUID();
  try {
    await keepCuisine(supabase, fields.cuisine);
    const { error } = await supabase.from("recipes").insert({ id, ...fields, photo: draft.photo ?? null });
    if (error) throw new Error(error.message);
  } catch (error) {
    Sentry.captureException(error);
    return { error: "The recipe couldn't be saved. Try again." };
  }
  await supabase.from("recipe_imports").delete().eq("id", importId);
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
    const { error } = await supabase.from("recipes").update(fields).eq("id", id);
    if (error) throw new Error(error.message);
  } catch (error) {
    Sentry.captureException(error);
    return { error: "The changes couldn't be saved. Try again." };
  }
  refresh();
  redirect(`/meal-plans/${id}`);
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
