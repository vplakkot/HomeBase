-- A video's caption (REQ-182). The downloaded video has none of the text
-- under it, so a person can add it: pasted text, and up to 2 screenshots
-- (shrunk JPEGs, as base64). They wait here only until Gemini has read
-- them with the video; the server then empties both columns.
alter table public.recipe_imports
  add column caption_text text,
  add column caption_images jsonb;
