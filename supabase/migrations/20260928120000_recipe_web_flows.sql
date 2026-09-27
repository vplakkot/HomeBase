-- REQ-112's web flows and REQ-110's two labels.
--
-- "Recipe missing" needs nothing stored: a card with no ingredients and
-- no steps has no recipe yet. "AI-generated" does: a recipe Gemini wrote
-- from its name alone is marked until either of us edits it.
alter table public.recipes
  add column ai_generated boolean not null default false;

-- A draft can now come from a recipe page found on the web (its link is
-- kept for the card), or be Gemini's generic version for a card that's
-- already saved as "Recipe missing" (saving it fills that card in).
alter table public.recipe_imports
  add column page_url text,
  add column recipe_id uuid references public.recipes (id) on delete cascade,
  add column ai_generated boolean not null default false;
