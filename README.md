Intent to create the HomeBase App. More details to follow soon. 

## Google Places: keeping Restaurants free (REQ-139)

Restaurants asks Google Places (New) about each saved place every time
it's shown; we keep only the place ID. Google's free monthly usage is
counted per kind of request, and a request is charged at the dearest
field it asks for:

- A tile asks only for name, cuisine, neighbourhood and a photo
  reference. Google bills that as Place Details **Pro** (5,000 free).
- Opening a place adds hours and website: Place Details **Enterprise**
  (1,000 free). That only happens on a place's own page.
- Each photo shown is a Place Photo request (1,000 free), the tightest.
  Tiles load theirs only as they scroll into view, and a phone keeps
  each one for a day.

### A cap so a bug can't run up a bill (set 2026-09-28)

Google bills Places by the request, with a free amount each month, and
has no spending cap in dollars. So the cap is a limit on requests, per
method, per minute and per day. They live in Google Cloud console →
**Google Maps Platform → Quotas → Places API (New)** (not APIs &
Services → Quotas, where Gemini's are). Vin set these on 2026-09-28:

| Quota | Per minute | Per day | Why |
|---|---|---|---|
| GetPlaceRequest (tiles, a place's page) | 100 | 150 | 150 × 31 = 4,650, under the 5,000 free Place Details Pro |
| GetPhotoMediaRequest (photos) | 60 | 30 | 30 × 31 = 930, under the 1,000 free photos |
| SearchTextRequest (adding a place) | 10 | 30 | well under the 5,000 free Text Search Pro |

Opening a list asks about every place on it at once, so the per-minute
limits sit above the size of our lists; lower and a busy list goes
blank. Opening a list of 20 places costs 20 GetPlace, so 150 a day is
about seven opens; past it, tiles say "Couldn't load from Google" until
the next day. The other quotas on that page are Google's defaults;
HomeBase doesn't use those methods.

A place's own page is billed as Place Details Enterprise (1,000 free),
but counts against the same GetPlace limit, so the per-day limit can't
keep that one free on its own. A **$1 budget** with an email alert
(**Billing → Budgets & alerts**) catches that and anything else: it
warns at the first charge, but doesn't stop requests.

The per-minute limits stop a runaway loop quickly; the per-day limits
and the budget alert catch slow, steady overuse.
