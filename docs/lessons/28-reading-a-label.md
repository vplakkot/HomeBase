# 28. Reading a label

Scanning a bottle takes two different skills, and HomeBase splits them
between Google and our own code.

## 1. Seeing letters: Google Cloud Vision

Turning a photo into text is **OCR** (optical character recognition).
It's hard: curved bottles, gold foil, fancy fonts. So we rent it. Our
server sends the photos to Google Cloud Vision with a secret key, and
Vision answers with every piece of text it saw: each word, where it
sits in the photo, and how sure it is (0 to 1).

The key is like a membership card for Google's service. It lives only
in Vercel's settings, marked Sensitive, and only the server reads it.
If it were in the browser, anyone could copy it and run up our bill.
That's also why the Google side has a budget alert and a key restricted
to Vision alone.

## 2. Knowing what the letters mean: our code

Vision says "BODEGAS FICTICIAS", "Reserva Especial", "RIOJA", "2019",
"14% vol". It doesn't say which is the producer. That's
`parseLabel`'s job, with three tools:

- **Lists.** "Rioja" is on our regions list, so it's the region.
  "Shiraz" is on the grapes list. The same lists the add form suggests from do
  double duty here.
- **Patterns.** A year on its own is a vintage; a number with "%" is
  alcohol; "750 ml" or "75 cl" is a bottle size.
- **Size.** Nothing lists every producer or wine name. But labels print
  those biggest, so the largest text nobody else claimed becomes the
  name, and a line with "Bodega", "Château" or "Domaine" the producer.
  These are guesses, so they're marked "check this".

Our first real bottles sharpened the guess. Two neighbouring lines
printed about the same size are one name ("LA" over "SONRIENTE").
Seals and fine print ("Produção sustentável", "Product of Italy") are
never the producer. "Produced and bottled by: …" names the winery. And
the front label, wrapped round the bottle, can cut a name short that
the flat back label prints whole.

Two rules keep it honest. Anything Vision was unsure of gets marked.
And nothing is inferred: "Rioja" doesn't fill in Spain unless the label
says Spain, and a grape doesn't make a wine red.

## 3. Have we had it?

Once the fields are read, the server compares them with every drink we
have: the same producer, name and vintage is a match, and the same wine
from another year is a near match. Capital letters and accents don't
count, so "RESERVA ESPECIAL" matches "Reserva Especial". This happens
before anything is saved, which is what makes it useful in a shop.

## When it goes wrong

No key, Vision down, or over 9 seconds: the review screen opens empty
with "Nothing could be read", and Sentry gets the reason. The scan
never gets stuck.

## Where to look

- `lib/drinks/vision.ts`: the request, and turning the answer into lines.
- `lib/drinks/parse-label.ts`: lines into fields.
- `lib/drinks/match.ts`: the shop check.
- `app/drinks/actions.ts`: `readLabel`, which ties them together.
