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

### A cap so a bug can't run up a bill (a step for Vin)

Google documents its Places (New) limits **per minute, per method**
(each kind of request has its own). Not checked from here: whether the
console also offers a per-day limit for your project.

1. Google Cloud console → **Google Maps Platform → Quotas**.
2. Choose **Places API (New)**.
3. For each of these methods, tick its row, **Edit**, enter the value,
   **Submit request**:
   - Get Place (tiles and a place's page): **100 per minute**
   - Search Text (adding a place): **10 per minute**
   - Get Photo Media (photos): **60 per minute**

   Opening a list asks about every place on it at once, so these sit
   above the size of our lists; lower and a busy list goes blank.
4. If a **per day** row is listed for those methods, set it too:
   Get Place **190**, Search Text **30**, Get Photo Media **30**. That
   keeps a month under the free amounts above. Opening a list of 20
   places costs 20 Get Place, so 190 a day is about nine opens; past
   it, tiles say "Couldn't load from Google" until the next day.
5. **Billing → Budgets & alerts**: a budget of **$1** with an email
   alert, so any charge at all is noticed. (A budget warns; it does
   not stop requests.)

The per-minute limits stop a runaway loop quickly; only a per-day
limit or the budget alert catches slow, steady overuse.
