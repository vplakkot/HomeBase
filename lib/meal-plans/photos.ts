// Recipe photos (REQ-110) live in a private bucket, like drink labels,
// with a small copy for lists beside each (lib/drinks/photos.ts thumbPath).
export const RECIPE_PHOTOS = "recipe-photos";

// A new name each time, so a replaced photo never shows an old cached one.
// `owner` is a recipe id, or "imports/<id>" for a video's still before
// the recipe exists.
export function recipePhotoPath(owner: string, now = Date.now()): string {
  return `${owner}/${now}.jpg`;
}
