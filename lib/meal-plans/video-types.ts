// The videos Gemini reads (REQ-112), by type, with the file ending each
// usually has: a phone doesn't always say a file's type, so the ending
// stands in.
export const VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/mpeg": "mpeg",
  "video/3gpp": "3gp",
};

// Google takes up to 2 GB; a recipe clip is far smaller.
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

// What a video import is called until it has been read: the video says
// what the dish is, so nobody has to name it first.
export const UNNAMED_RECIPE = "Recipe from a video";

// The same for a recipe read from pictures (REQ-157).
export const UNNAMED_IMAGES = "Recipe from images";

// What the phone may send for one recipe: each picture shrunk to a few
// hundred kilobytes, and all of them well under Vercel's limit of about
// 4.5 MB a request (the recipe goes through our server, unlike a video).
export const MAX_IMAGES = 3;
export const MAX_IMAGES_BYTES = 2.5 * 1024 * 1024;

// REQ-156: frames the phone takes from a video for its photo, and the most
// Gemini may keep as candidates.
export const MAX_FRAMES = 8;
export const MAX_KEPT_FRAMES = 3;
