# 34. A form that forgets what was saved

A dropdown that saves as soon as you change it can still show the wrong
answer afterwards. REQ-176 was exactly that: pick "2 meals", the leftover
lunch appears (so it saved), and the dropdown goes back to "1 meal".

## What went wrong

The dropdown was told its starting value once: `defaultValue`. Think of a
whiteboard with a note stuck at the top saying "start here: 1 meal".
After you save, React wipes the form back to that note. When the page
comes back from the server saying "2 meals", someone writes a new note,
but the whiteboard was already hanging on the wall, and it never reads
the new note. So the wipe puts it back to "1 meal".

Two things followed. The dropdown lied about what was saved. And picking
"2 meals" again did nothing (already saved), while "1 meal" was already
showing, so there was nothing to pick. It looked like a dropdown you
couldn't use.

## The fix

Give the dropdown a `key` that is the saved value. A key tells React
"this is the same thing as long as the key is the same". When the saved
size changes, the key changes, so React throws the old dropdown away and
builds a new one that reads the new note. The test in
`app/meal-plans/plan-forms.test.tsx` fails without the key.

## When to look for it

Any dropdown, checkbox or text box that has a `defaultValue`, saves
itself, and shows data that the server can change. Controlled inputs
(which hold their value in React state) don't have this problem, but
need the state kept in step with the server instead.
