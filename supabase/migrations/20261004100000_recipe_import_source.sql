-- Where a draft came from, so the review screen knows it is a video (BETA
-- label, candidate photos) or pictures, instead of guessing from a link or
-- a photo. Null for drafts made before this, and for text, page and generic
-- drafts, which need no special treatment.
alter table public.recipe_imports
  add column source text check (source in ('video', 'images'));
