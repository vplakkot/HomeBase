# 31. Searching and fetching the web

Adding a recipe you've only seen in a video (REQ-112) means finding it
on the web: search for the dish, pick a page, and have Gemini read it.
Two new ideas came with that.

## 1. Search through the AI we already have

We needed a search engine we could call from code. Google's own
Custom Search is closed to new users and shuts in January 2027; Brave's
needs its own account and card. Gemini, which we already pay for, can
run a Google search itself (its **Google Search tool**, called
"grounding"): we ask it for recipe pages for a dish, and alongside its
answer it lists the pages Google found. That list is all we use. What
Gemini *writes* about the pages is ignored, because a model can make up
an address; the pages Google returned are real.

Two quirks, both seen on a real search on 2026-09-27:

- Each page comes as a **Google redirect link**, not its address. Our
  server asks the link where it leads (Google answers "302, go here")
  without downloading anything, and keeps the real address.
- Google's terms ask that its **search suggestions**, a small block of
  HTML it sends, are shown with the results. We show it in a sealed
  frame (`<iframe sandbox>`), so its code can't touch HomeBase.

The first free 5,000 searches a month cost nothing; we use a handful.

## 2. A server that fetches what a browser names

Once a page is picked, our server downloads it and hands the recipe to
Gemini. The address comes from the browser, and anything a browser
sends can be changed on the way. A server that fetches whatever it's
told can be pointed inward, at addresses only it can reach: the
building's internal phone lines, not the public phone book. The name
for that attack is **server-side request forgery**.

So `isPublicPage` lets through only an ordinary public web address:
https, a real domain name, no numbers-only address, no `localhost` or
`.local`, no password in the address, no unusual port. And a redirect
isn't followed blindly: each hop is checked the same way before it's
fetched, three hops at most. A page that redirects to `127.0.0.1` is
refused, and a test proves it.

Most recipe sites describe the recipe in a block written for search
engines (JSON-LD, `"@type": "Recipe"`). When it's there, Gemini gets
that block and nothing else: no ads, no life story. Otherwise it gets
the page's words with its code stripped out.

## 3. Two labels, one stored

"Recipe missing" isn't stored at all: a card with no ingredients and no
steps has no recipe, whichever way it got like that. "AI-generated" *is*
stored (`recipes.ai_generated`), because nothing in the card itself
says who wrote it. Gemini writes a recipe of its own only here, when
asked on a "Recipe missing" card, and any edit clears the label.

## Where to look

- `lib/meal-plans/recipe-search.ts`: the search's pages, safe fetching,
  and a page's recipe as text.
- `lib/meal-plans/gemini.ts`: `searchRecipePages`, `pagePrompt`,
  `genericPrompt`.
- `app/meal-plans/actions.ts`: `findRecipePages`, `draftFromPage`,
  `saveRecipeMissing`, `draftGeneric`.
