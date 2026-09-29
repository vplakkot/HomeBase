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
