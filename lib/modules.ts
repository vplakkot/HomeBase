// The one list of HomeBase's modules. Home's tiles, the desktop sidebar
// and the phone's module switcher are all drawn from it, so adding a
// module means adding an entry here (docs/design/DESIGN.md §3, and the
// Notion decision that the list lives in the code, not the database).
//
// v0.2 showed six, and only Finances opened (a Notion decision of
// 2026-09-21): a module without an `href` is listed and can't be tapped.
// v1.0 adds Paperwork and Storage, the second and third to open.

export type ModuleSection = {
  name: string;
  description: string;
  // Admin-only sections are shown to members too, locked. Finances has
  // none now: its admin settings sit behind the header's gear (§6).
  adminOnly?: boolean;
  // The module's most frequent action (DESIGN.md §6): a button of its own
  // rather than a tab on a desktop.
  pinned?: boolean;
  // The section's page, once it has one; until then it's listed as coming.
  href?: string;
  // A page about one month: its link keeps the month you're looking at.
  monthly?: boolean;
  // Not listed at all, for now (Finances: Savings while it's paused).
  hidden?: boolean;
};

// Savings is paused (REQ-103, 2026-09-25): its tab and the verdict card
// are hidden. The page and its data stay; flip this to bring them back.
export const SAVINGS_PAUSED = true;

export type Module = {
  slug: string;
  name: string;
  // The start of the module's colour tokens in docs/design/tokens.css:
  // "finances" means --finances-loud, --finances-quiet and the rest.
  tokens: string;
  // The module's home page, or null while the module has no pages.
  href: string | null;
  sections: readonly ModuleSection[];
};

export const MODULES: readonly Module[] = [
  {
    slug: "finances",
    name: "Finances",
    tokens: "finances",
    href: "/finances",
    sections: [
      {
        name: "Monthly entry",
        description: "Bills, personal charges, One-time Payments",
        href: "/finances/monthly-entry",
        monthly: true,
      },
      {
        name: "Log payment",
        description: "Several times a month",
        pinned: true,
        href: "/finances/log-payment",
        monthly: true,
      },
      {
        name: "Payments",
        description: "Every payment logged in the month",
        href: "/finances/payments",
        monthly: true,
      },
      {
        name: "Income",
        description: "Confirm paychecks, add ESPP, RSU, bonus",
        href: "/finances/income",
        monthly: true,
      },
      {
        name: "Savings",
        description: "Verdict and what you actually saved",
        href: "/finances/savings",
        hidden: SAVINGS_PAUSED,
      },
      { name: "Balances", description: "Enter and see trends", href: "/finances/balances" },
      { name: "History", description: "Every month so far", href: "/finances/history" },
    ],
  },
  { slug: "calendar", name: "Calendar", tokens: "calendar", href: null, sections: [] },
  { slug: "pets", name: "Pets", tokens: "pets", href: null, sections: [] },
  // Opened in v2.0 (REQ-37, REQ-30, REQ-29). Called Wine until then; the
  // requirements call it Drinks, and it keeps the violet it had.
  {
    slug: "drinks",
    name: "Drinks",
    tokens: "wine",
    href: "/drinks",
    // REQ-36: the wines we only want to try have their own view.
    sections: [{ name: "Want to try", description: "Wines to try next", href: "/drinks/want-to-try" }],
  },
  { slug: "meal-plans", name: "Meal Plans", tokens: "meals", href: null, sections: [] },
  { slug: "health", name: "Health", tokens: "health", href: null, sections: [] },
  // Added in v1.0 (REQ-88, REQ-97); Vin chose slate and the last place
  // on 2026-09-24.
  {
    slug: "paperwork",
    name: "Paperwork",
    tokens: "paperwork",
    href: "/paperwork",
    // DESIGN.md §11: Overview, Unfiled and Categories. Log document is a
    // sheet from the header, and managing categories is behind the
    // settings gear (admin), not a tab.
    sections: [
      { name: "Unfiled", description: "Documents waiting for a file", href: "/paperwork/unfiled" },
      { name: "Categories", description: "Every document by category and year", href: "/paperwork/categories" },
    ],
  },
  // Added in v1.0 (REQ-87); Vin chose teal and the last place on
  // 2026-09-24.
  {
    slug: "storage",
    name: "Storage",
    tokens: "storage",
    href: "/storage",
    // REQ-107: one home screen; Add to storage is a sheet from the
    // header, like Paperwork's Log document.
    sections: [],
  },
];

// A module switched off in the admin console disappears from Home, and
// its data is kept (DESIGN.md §3). The console's switches come in a later
// milestone, so for now nothing is switched off.
export const NOTHING_SWITCHED_OFF: ReadonlySet<string> = new Set();

export function modulesSwitchedOn(switchedOff: ReadonlySet<string>): readonly Module[] {
  return MODULES.filter((module) => !switchedOff.has(module.slug));
}

export function moduleBySlug(slug: string): Module {
  const found = MODULES.find((module) => module.slug === slug);
  if (!found) throw new Error(`No module called ${slug}`);
  return found;
}

// A module's colours under generic names, for a component to set on the
// element that shows the module. Its stylesheet then says
// var(--module-loud) and works for every module, instead of naming each
// one's tokens.
export function moduleColours(module: Module): Record<string, string> {
  const t = module.tokens;
  return {
    "--module-loud": `var(--${t}-loud)`,
    "--module-on-loud": `var(--${t}-on-loud)`,
    "--module-quiet": `var(--${t}-quiet)`,
    "--module-quiet-line": `var(--${t}-quiet-line)`,
    "--module-quiet-ink": `var(--${t}-quiet-ink)`,
    "--module-quiet-title": `var(--${t}-quiet-title)`,
  };
}
