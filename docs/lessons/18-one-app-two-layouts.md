# Lesson 18: One app, two layouts

REQ-18 and REQ-81 give HomeBase a phone layout and a desktop layout, and
the Home screen that lives in both. The rule behind them is in Notion's
Platforms page: the screen size decides the layout, never what you can
do.

## The width decides, not the device

There are two ways to give phones and desktops different screens. One is
to ask the browser what device it is and send different pages. The other
is to send one page that holds both layouts, and let the stylesheet pick
by width. HomeBase does the second.

The tool is a **media query**: a block of CSS that applies only when a
condition holds. Ours is always the same one:

```css
@media (min-width: 1024px) { … }
```

Outside that block are the phone rules; inside it, the desktop changes.
It's like a coat with a zip-out lining: one garment, and the weather
decides which way you wear it. Widen a window past 1024 px and the
sidebar appears on the spot, with no reload. We checked that in a
browser: 1023 px gave the phone layout, 1024 px the desktop one.

Device detection would have been worse. A phone in landscape, a small
laptop window and a new tablet would each need a guess.

## A frame that doesn't scroll

On a phone, the Quick add bar and the module bar must never scroll
away. So the frame fills the screen and stays still, and only the middle
part scrolls. Think of a picture frame with a scroll of paper wound
through it. The bar sits under the page rather than on top of it, so
nothing is ever hidden behind it.

Phones with a notch and a home bar cut into the screen's edges.
`viewport-fit=cover` lets the page reach those edges. Then each edge is
padded by the screen's **safe-area inset**, how far the cut goes in.
That's the theory; it hasn't been checked on an iPhone yet, because
there's no simulator on this Mac.

## Sheets

Sections, the module switcher and Quick add all open a **bottom sheet**:
a panel that slides up over the page. It's built on `<dialog>`, which
browsers provide, so we don't write the fiddly parts ourselves. We saw
in a browser that opening one moves keyboard focus into it, and closing
it hands focus back to the button that opened it. It should also close
on Escape, but the automation here sends key presses the browser won't
act on, so that part is unchecked.

## Same capabilities, checked

"Every action on desktop is also on phone" is easy to promise and easy
to break. A new sidebar link with no phone equivalent would quietly
strand phone users. So a test renders the pages the way both layouts
receive them. It collects every place the sidebar can reach, and checks
each one can also be reached from the parts a phone shows. The admin
console, for example, is the sidebar's last link on desktop and the
Admin pill on a phone.

## One list of modules

Home's tiles, the sidebar and the module switcher all come from
`lib/modules.ts`. Adding a module means one new entry, and all three
pick it up. Each entry names its colour tokens by prefix ("meals" for
Meal Plans). Components receive a module's colours under generic names
like `--module-quiet`, so one stylesheet works for all six. A test fails
if a prefix is misspelt, because the browser wouldn't complain.

## The greeting

"Morning, Vin" needs the time where the phone is, and a request for a
page doesn't say what time zone it came from. So the page arrives
saying "Hello", and the phone fills in its own greeting and date a
moment later. Storing the household's time zone in the code would
publish roughly where they live, and the repository is public.
