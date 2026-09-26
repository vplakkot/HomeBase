# 25. A screen that stays put

The Paperwork and Storage redesigns (#185, #189) and the Finances pages
(#187) changed how screens behave, not just how they look. Three ideas
did the work: forms in sheets that report back, search kept in the
address, and one set of styles shared instead of copied.

## Forms that report back instead of moving you

Before, adding a Storage entry was a page of its own. Saving sent you
to the new entry's page (a *redirect*), so you always ended up
somewhere other than where you started.

Now "Add to storage" opens a **sheet** over whatever screen you're on.
The form's save runs on the server as before, but instead of
redirecting it *returns an answer*: `{ saved: true, newEntry: "S-010" }`.
The sheet listens for that answer, closes itself, and shows the new ID
once to print. Close that, and you're exactly where you were.

It's the difference between a shop assistant who walks you to the
till, and one who takes your order and brings the receipt to your
table. The work is the same; you never had to get up.

Errors come back the same way (`{ error: "Give the entry a name." }`)
and show inside the sheet, next to the form that caused them.

In code: `addEntry()` in `app/storage/actions.ts` returns the answer;
`useOnSaved()` in `app/storage/forms.tsx` notices `saved` and tells the
sheet; `HeaderTools` in `app/storage/sheets.tsx` closes it and opens
the notice. Paperwork's Log document works the same way.

## Search that lives in the address

Typing in the header search and pressing Enter sends you to the *same*
screen with `?q=ski boots` on the end of its address. The screen reads
`q`: if it's there, the results take the page's place; if not, the page
shows as normal. **Clear** is simply a link to the address without `q`.

Because the search is in the address rather than hidden in the
browser's memory, going Back works, a refresh keeps your results, and
Clear always lands you on the screen you searched from, whether that
was Storage's home or a single box. A bookmark with a sticky note on it
is still the same bookmark.

## One stylesheet, shared, not copied

Every module's cards now follow the same rules (DESIGN.md §6), so the
styles live once and are shared:

- `components/cards.module.css` is used by Finances, Paperwork's
  settings and Storage's forms. Its colour comes from `--module-loud`,
  which each module's frame sets, so the same card is brick in
  Finances and teal in Storage. One stencil, different paint.
- Storage's screens have the same shapes as Paperwork's. Rather than
  copy 200 lines, `app/storage/storage.module.css` **borrows** each one:

  ```css
  .card { composes: card from "../paperwork/paperwork.module.css"; }
  ```

  `composes` is CSS Modules' way of saying "this class is that class".
  The element gets both class names, so a later fix to Paperwork's card
  fixes Storage's too. A copy would have drifted the first time one of
  them changed.

One trick in the shared cards is worth a look: the heading sits
*above* the card's border, without changing any page's markup. The
border is drawn on the blocks after the heading, not on the section
that holds them: the first block draws the top edge, the last one
the bottom, every one the sides (`.card > .head + *` and
`.card > :last-child` in `cards.module.css`).

## How it was checked

The page tests open the sheets, save, and check the notice appears
and closes back onto the same screen; search tests check that results
replace the view and that Clear points at the address you came from.
`components/cards.test.ts` checks the shared card's rules (border,
corners, one button style). Because `composes` only works in the real
build, the Storage screens were also rendered locally in a browser to
see the teal borders come through.
