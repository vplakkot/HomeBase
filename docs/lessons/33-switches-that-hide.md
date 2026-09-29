# 33. Switches that hide, never delete

REQ-141 asked for something that sounds destructive, "turn a module
off", with a promise attached: no data is lost, and turning it back on
brings everything back exactly as it was. REQ-143 asked for a smaller
version for one person. Both come down to one idea.

## The analogy

Think of a light switch, not a demolition crew. Turning off the lights
in the spare room doesn't empty it; the furniture is still there in the
dark, and flipping the switch shows it all again. A module that's off is
a room with its lights off. Hiding a module for yourself is closing your
own eyes: the room is lit for everyone else.

## What's stored: the switch, not the room

The module's data (bills, drinks, recipes) is never touched. What's
stored is only the position of the switch:

- `modules_off`: a row means "this switch is off for everyone".
- `modules_hidden`: a row means "this person doesn't want to see it".

"On" is the *absence* of a row. That keeps the default safe: a brand-new
module, or one nobody has touched, is on without anyone writing
anything. And turning a module back on is deleting one row from the
switch table, never restoring anything, because nothing was taken away.

The migration has a test that lists every write it makes, so a later
edit can't quietly add one that deletes a module's rows.

## Settings stored as data, not code

The list of modules stays in the code (`lib/modules.ts`): adding a
module means writing its screens anyway. But *which ones are on* is
data, so the admin changes it from the app, and it takes effect on the
next page load, with no new release. This is the same move as lesson 9
(permissions as rows): a rule that changes at runtime belongs in the
database.

## One gate, where everything passes

A switch has to be obeyed everywhere a module appears: the sidebar, the
phone's module switcher, Home's tiles, action items, Quick add, pushes,
and any old link. Checking in every one of those places would be easy to
forget in the next module.

Instead, the switch position rides along with something every page
already loads: the account, which draws the menus. And every module
page sits inside the same frame (`AppFrame`). So the frame is the one
door: if the module you're walking into is off, it sends you to Home
with a note. Navigation just draws from "modules that are on and not
hidden".

The one place outside that door is the hourly Finances job, which isn't
a page. It asks the switch table itself before sending anything.

## Off and hidden aren't the same thing

Vin's rule for hiding: "someone's choice to hide a module doesn't
absolve them of their work." So the two are drawn from different lists:

| | Navigation and tiles | Action items and pushes | Opening a link |
|---|---|---|---|
| Off (everyone) | gone | gone | lands on Home |
| Hidden (me) | gone | still mine | still opens |

That's why the helpers are two functions, `modulesOn` and
`modulesShown`, rather than one list with exceptions.

## When the switch can't be read

If the switch table can't be read, pages treat everything as on: losing
a switch should never take the app down. The Finances job does the
opposite and fails, because it's safer to skip a reminder than to send
one for a module that might be off.

## Where to look

- `supabase/migrations/20261002100000_module_switches.sql`: the two
  tables, their policies, and `choose_modules()` for the setup step.
- `lib/modules.ts`: `SWITCHES`, `modulesOn`, `modulesShown`.
- `lib/module-switches.ts`: reading them, and the fallbacks.
- `components/app-frame.tsx`: the one door.
- `supabase/checks/module_switches.sql`: the live check.
