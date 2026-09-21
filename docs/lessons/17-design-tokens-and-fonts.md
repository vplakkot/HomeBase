# Lesson 17: Design tokens and fonts

REQ-79 is the first code of the v0.2 design. Nothing is laid out
differently yet; what changes is that every page now draws its colours
and fonts from the design, and from one place.

## A token is a named paint colour

A decorator doesn't tell the painter "mix 70% red with a little brown".
They say "brick", and the paint chart says what brick is. Change the
chart and every wall painted brick changes with it.

`docs/design/tokens.css` is that chart. It says, once:

```css
--finances-loud: #B23A2B;
```

and every stylesheet says `var(--finances-loud)`, never `#B23A2B`. The
name is the **token**; the browser looks up its value when it draws the
page. The app reads this file straight from the design folder rather
than keeping a copy, so the design and the app can never disagree about
what brick is.

A rule only helps if something enforces it, so a test reads every
stylesheet and component and fails on any raw colour code, font or corner
size. It also fails on a token name that doesn't exist. That one matters
more than it sounds: the browser raises no error for a misspelt token. It
quietly resets the colour or size to its default. We checked: a
background with a misspelt token went transparent.

## Loud, quiet, and "on-loud"

Each module has a **loud** colour, used only when it needs you, and a
**quiet** tint for when it doesn't. Text sitting on a loud colour uses
that module's **on-loud** token. For most modules that's white, but white
on mustard or rose is too faint to read, so Meal Plans and Pets use dark
ink.

"Too faint" has a number. **Contrast ratio** compares how bright two
colours are, from 1 (identical) to 21 (black on white). Ordinary text
needs at least **4.5**. A test measures every text-on-surface pair in the
tokens, and all of them pass. Two colours drawn in the mockups don't: the
soft status lines on the brick and forest tiles measure 4.28 and 4.18.
DESIGN.md says its rules beat its mockups, so those lines will use the
on-loud token instead.

## Fonts that come with the app

A web page can borrow fonts from Google each time someone opens it, like
a library book. `next/font`, which is part of Next.js, buys the books
instead. While the app is being built, it downloads Bricolage Grotesque
and Plus Jakarta Sans once, and HomeBase then serves them from its own
address. Opening the app never contacts Google. The price is that
*building* needs Google: we built through a dead connection, and the
build stopped with "Failed to fetch Bricolage Grotesque from Google
Fonts". That's the right failure, loud and before anything ships.

Bricolage is loaded with its **optical-size** setting, as the mockups
were drawn: at headline sizes its letters sit tighter and finer. That
makes it 77 KB rather than 22 KB, downloaded once and then kept.

While a font file is still on its way, text shows in a system font that
`next/font` has resized to the real font's proportions. It's like an
understudy the same height as the lead, so nothing on the page jumps
when the swap happens.

## Why the fonts are attached to `<html>`

`next/font` passes each font's name through a CSS variable. Variables
flow downward only: set on an element, they reach that element and
everything inside it. The tokens live on `:root`, which is `<html>`, so
that's where the variables have to go. We tried them on `<body>` in a
browser: headings still asked for Bricolage Grotesque by its plain name,
but the resized understudy had dropped out. A test keeps them on
`<html>`.

## What's next

REQ-80 adds the app icon and the brand lockup. After that come the
phone and desktop layouts, which give these tokens their first real
screens.
