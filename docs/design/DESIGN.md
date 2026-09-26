# HomeBase design (v1.0)

This folder is the design reference for HomeBase. The **rules below take priority over the mockups**: the mockups show a few example states, the rules say what to do in every state.

| File | What it is |
|---|---|
| `tokens.css` | All colours, fonts, radii and spacing as CSS variables. Components use these names, never raw values. |
| `icon.svg` | App icon and brand mark. |
| `mockups/*.html` | Static reference screens. They were drawn in a design canvas and need its runtime to render, but the markup and inline styles are readable: use them for exact sizes, spacing and structure. Sample data is invented. |

Canvas (owner access only): https://claude.ai/artifact/1RVqqy4UV3iXLJ4ZEsfCsu

---

## 1. Principles

- **Bold, not busy.** A warm-white page with vivid module colours. Colour is used to signal, not to decorate.
- **Colour means "needs you".** A module shows its loud colour only when it has an action item. Otherwise it is quiet. A calm day should look calm.
- **Phone first, one hand.** Frequent actions sit at the bottom of the screen. Minimum tap target 44 × 44 px.
- **Same capabilities on phone and desktop.** Desktop can show more at once; it never does more.
- **Not a finance app.** No spending categories. No charts on phone. Desktop reserves space for two charts (see §7) that are built later.

## 2. Brand

- Fonts: **Bricolage Grotesque 800** for display (titles, headlines, big numbers). **Plus Jakarta Sans 400–700** for everything else. Load both from Google Fonts.
- Section labels: 11 px, uppercase, weight 700, letter-spacing 0.1em, `--color-muted`.
- App icon: `icon.svg` — a white roof over four module tiles (brick, cobalt, mustard, forest). For `apple-touch-icon` and PWA icons, export square PNGs **without** the rounded corners (iOS applies its own mask); sizes 180, 192, 512.
- Brand lockup (icon 30 px + "HomeBase" in display 19 px) sits top-left on phone Home and at the top of the desktop sidebar.

## 3. Modules and colours

| Module | Loud | Quiet |
|---|---|---|
| Finances | brick `--finances-loud` | `--finances-quiet` |
| Calendar | cobalt `--calendar-loud` | `--calendar-quiet` |
| Pets | rose `--pets-loud` | `--pets-quiet` |
| Drinks (was Wine) | violet `--wine-loud` | `--wine-quiet` |
| Meal Plans | mustard `--meals-loud` | `--meals-quiet` |
| Health | forest `--health-loud` | `--health-quiet` |
| Paperwork | slate `--paperwork-loud` | `--paperwork-quiet` |
| Storage | teal `--storage-loud` | `--storage-quiet` |

- Modules are defined in **one list** (name, slug, icon, token prefix, sections). Home, the sidebar, the module switcher and the admin console all read from it. Adding a module = adding an entry.
- A module switched off in the admin console disappears from Home, the sidebar and the switcher. Its data is kept.
- Text on loud tiles uses `--<module>-on-loud`. Some modules use dark ink on their loud colour (Pets, Meal Plans) because white would fail contrast; always use the token.

## 4. Home

### Phone (below 1024 px)
Top to bottom, inside one scrolling area:
1. Brand lockup (left) and the **Admin** pill (right, admins only) which opens the admin console.
2. Greeting ("Morning, Vin") and date.
3. **Action items** (§5).
4. **Modules** label, then a 2-column grid of module tiles.

Below the scrolling area, a **fixed Quick add bar**: Expense, Event, Meal. Each opens a bottom sheet to create the item without leaving Home. The bar never scrolls away. Tiles scroll under it; more modules simply add rows.

There is **no navigation bar on Home**. The tiles are the navigation.

### Desktop (1024 px and up)
- Sidebar (248 px): brand lockup, Home, Modules list (colour dot + name), then at the bottom the Admin console link (admins only) and the user menu.
- Main area: greeting and date on the left, **Quick add** buttons top-right.
- Action items: all shown side by side (max 3), no swiping or counter.
- Module tiles: 3-column grid. Each desktop tile shows a headline plus two supporting facts.

### Module tile rules
- Tile shows: icon in a round chip, module name, one status line (phone) or headline + two facts (desktop).
- **Loud** (solid module colour) if and only if the module has at least one action item. Otherwise **quiet** (tint + border).
- The whole tile is one link to the module's home.

## 5. Action items

Replaces the old "Needs you" label. Label: **ACTION ITEMS**.

- Maximum **3** at a time, ordered by urgency.
- Each item shows: the module's icon on its loud colour, one line of text, one line of detail, and a chevron. **No module name** — the icon identifies it.
- Tapping an item deep-links to the exact screen (e.g. the bill), not the module home.
- **Phone:** one dark card (`--color-panel`). If there is more than one item, the card is a horizontal swipe stack: stacked edges show behind it, a "1 / 3" counter sits right of the label, and dots sit below the card. One item: no counter, no stacked edges.
- **Desktop:** up to 3 dark cards side by side.
- **None:** replace the card with a green "All clear" row ("No action items today").
- Never auto-rotate.
- This section is Home's action items. Inside a module, action items use the module-home card instead (§6, Module home layout).

## 6. Navigation inside a module

### Phone
A fixed bottom bar with exactly three buttons, the same in every module:

| Button | Does |
|---|---|
| Home | Returns to Home |
| Sections | Opens a bottom sheet listing the module's sections. Shown as **selected** (not greyed out) while on the module's own home. |
| Modules (icon only, 2×2 grid, `aria-label="Other modules"`) | Opens the module switcher |

A module may pin its most frequent action above this bar (Finances: **Log payment**).

### Desktop
Sidebar as on Home, with the current module highlighted. The module's sections become a row of tabs under the page title. Admin settings are not a tab: they open from the settings gear in the header (see below).

### Module home layout (all modules — Vin, 2026-09-25)
Every module home follows the same rules. Mockups: `finances-desktop.html`, `paperwork-desktop-overview.html`.

**Surfaces and cards**
- The page and every card use the shell background (`--color-ground`). No filled, tinted or dark cards on a module home.
- Every card: **1.5px border in the module's loud colour**, **no shadow**, corner radius **`--radius-lg` (20px)** — the same as Home's module tiles. Hard rule, no exceptions.

**Colour**
- The module colour is used only for: card borders, buttons, progress bars, the active tab, the context in the title (e.g. the month), and urgent text such as "Overdue".
- Main text charcoal, secondary text grey. Charcoal is never a card fill.
- Status is **plain text** (Paid, Overdue), never a pill or chip. A past month's status is a small superscript after the title: "Closed", or "Open" if it was never closed. The current month shows none while it is open, and "Closed" once it closes early, paid up (Vin, 2026-09-25).

**Buttons**
- One button style everywhere on a module home — header, action item rows, "Acknowledge", "Previous months": solid module colour, white text, 44px tall, `--radius-md` (16px), 15px weight 600. No outlined or grey variants.
- **Settings gear**: module admin settings sit behind an icon-only gear button in the header, same button style, `aria-label="[Module] settings"`.

**Structure, top to bottom**
1. Header: module icon + title ("[Module] — [context]", context in the module colour), then the header buttons (secondary actions, settings gear, primary action).
2. Section tabs.
3. **Action items** card — only when there are items. One row per item: title, one line of detail, its button on the right. Acknowledge-only items use an "Acknowledge" button.
4. **Summary** card — the numbers that matter for the module.
5. Detail sections.

## 7. Finances (reference for v1.0)

Mockups: `finances-desktop.html` (Overview), `finances-desktop-payments.html`. Follows the module home layout (§6). Home of the module is the **current month**:
- **Header:** "Finances — September 2026" (month in brick), then **Previous months** (opens History), the settings gear (Budget year), and **Log payment**. No month picker, no status chip.
- **Tabs:** Overview, Monthly entry, Payments, Income, Balances, History. Savings is hidden while savings is paused. Budget year is not a tab; it opens from the settings gear.
- **Action items** (REQ-93): e.g. a bill "Overdue" or due soon (Log payment), "Household over budget" and one "You'll be over budget" per person whose share is more than their income (Acknowledge), month ended not squared. "Close month" appears only as an action item.
- **Progress** (the summary card, under its own heading like every section; Vin, 2026-09-25): still to pay (large), bills this month, paid so far, split, one progress bar, and "N% paid · N bill overdue".
- **Outstanding balances** (was "Who owes what"; Vin, 2026-09-25): one card per person: outstanding, share %, progress bar, "Paid $X of $Y". "How this was worked out" link.
- **Bills:** one row per bill: name, due date ("1 Sep · Overdue" in brick when late), progress, amount left.
- **Payments tab:** every payment logged in the month, newest first: date, who paid, toward (bill or "Direct payment"), amount; count and total above.
- **New month** opens automatically on the 1st: fixed bills (rent) pre-filled, card statements as placeholder rows, paychecks pre-filled to confirm.
- **Log payment** on phone stays pinned above the bottom bar; opens a sheet: who paid (segmented), amount, toward (bill chips), Save.
- **First run** (no budget year): the whole page is one card, "Set up your budget year", with Start setup (admin). Members see a message naming the admin, no button.
- **Desktop charts:** two chart slots are still reserved for later — *Share paid by person, by month* and *Income vs bills, by month*. Build later.
- Replaced on 2026-09-25: dark panel cards, loud brick / green card fills, the verdict card, status chips and the Admin block.

## 8. Admin console

Admins only. Phone: opened from the Admin pill on Home, back button to Home. Desktop: "Admin console" at the bottom of the sidebar.

Three cards (phone order: Notifications, Modules, People):
- **People**: each person with role chip; "Add person" button labelled as a setup step.
- **Notifications**: per person, an on/off switch, a **Send test** button and the last test result ("Test delivered · 2 min ago" / "Not verified yet"). Note: notifications never show dollar amounts.
- **Modules**: one on/off switch per module ("Visible to everyone" / "Hidden · data kept").

v0.2 builds the page layout and cards; the controls inside are wired up in later milestones.

## 9. Components (build once, reuse)

Brand lockup · Module tile (loud / quiet, phone / desktop) · Action item card (single / stacked, desktop row) · All-clear row · Quick add bar (phone) and buttons (desktop) · Module bottom bar · Bottom sheet · Section tabs (desktop) · Sidebar · Module card (1.5px module-colour border, `--radius-lg`) · Module header (title, buttons, settings gear) · Button (one style) · Action items card (module home) · Summary card · Plain-text status · Person card · Bill row · Toggle switch · Section label.

## 10. Hard rules

- No dollar amounts in notifications or on the lock screen.
- No spending categories.
- Tap targets at least 44 px; text contrast at least 4.5:1 (use the `on-loud` tokens).
- Layout switch at 1024 px.
- Never remove a capability on phone; at most put it behind one extra tap.

## 11. Paperwork (reference for v1.0)

Mockups: `paperwork-desktop-overview.html`, `paperwork-desktop-categories.html`, `paperwork-desktop-category.html`. Follows the module home layout (§6). Each paperwork item is called a **document** in the UI ("18 documents", "Log document"); the module is still Paperwork.
- **Header:** "Paperwork", search bar, settings gear (categories: admin), **Log document**.
- **Tabs:** Overview, Unfiled, Categories.
- **Action items:** the only one is "N documents unfiled on your desk" with **File it**.
- **Summary:** locations · files · documents.
- **Locations:** one card per office location, then "Archived in storage" (one card per box).
- **Categories tab:** one card per category (files · documents). A category page lists its documents by year, newest first; a year with nothing between the oldest and newest shows "Nothing logged for [year]" in the module colour so gaps stand out; undated documents last.

## 12. Storage (reference for v1.0)

Mockup: screens 6–7 of the Paperwork/Storage design canvas (REQ-107). Same shapes as Paperwork (§11), in teal:
- **Header:** "Storage", the one search (names, IDs, contents, notes; results replace the view, Clear returns), and **Add to storage** (a sheet; a one-time notice shows the new ID to print).
- **Home:** "Boxes · N" then "Not in a box · N", one card per entry: ID · name, archived paperwork files if any, a contents preview, the note in italics.
- **Entry:** breadcrumb Storage › ID; title "ID · name" with a small "Box" superscript; **Manage** menu (Edit, Show label to reprint, Remove). Cards: Contents (one per line) and Note ("No note"), then the archived paperwork files (ID, label name or "No label", documents), each opening in Paperwork.
