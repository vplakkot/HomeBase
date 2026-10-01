-- Which second of a video Gemini chose for the recipe's photo (REQ-156).
-- Gemini only says when; the phone that still has the video cuts the
-- picture out. Null when no moment qualified.
alter table public.recipe_imports
  add column photo_at numeric check (photo_at >= 0);
