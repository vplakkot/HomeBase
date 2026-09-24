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
  // Admin-only sections are shown to members too, locked (DESIGN.md §7).
  adminOnly?: boolean;
  // The module's most frequent action (DESIGN.md §6): a button of its own
  // rather than a tab on a desktop.
  pinned?: boolean;
  // The section's page, once it has one; until then it's listed as coming.
  href?: string;
};

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
      },
      {
        name: "Log payment",
        description: "Several times a month",
        pinned: true,
        href: "/finances/log-payment",
      },
      {
        name: "Income",
        description: "Confirm paychecks, add ESPP, RSU, bonus",
        href: "/finances/income",
      },
      {
        name: "Savings",
        description: "Verdict and what you actually saved",
        href: "/finances/savings",
      },
      { name: "Balances", description: "Enter and see trends", href: "/finances/balances" },
      { name: "History", description: "Closed months, read-only" },
      {
        name: "Budget year",
        description: "Split %, income sources and bills",
        adminOnly: true,
        href: "/finances/budget-year",
      },
    ],
  },
  { slug: "calendar", name: "Calendar", tokens: "calendar", href: null, sections: [] },
  { slug: "pets", name: "Pets", tokens: "pets", href: null, sections: [] },
  { slug: "wine", name: "Wine", tokens: "wine", href: null, sections: [] },
  { slug: "meal-plans", name: "Meal Plans", tokens: "meals", href: null, sections: [] },
  { slug: "health", name: "Health", tokens: "health", href: null, sections: [] },
  // Added in v1.0 (REQ-88, REQ-97); Vin chose slate and the last place
  // on 2026-09-24.
  {
    slug: "paperwork",
    name: "Paperwork",
    tokens: "paperwork",
    href: "/paperwork",
    sections: [
      { name: "Unfiled", description: "Paperwork waiting for a file", href: "/paperwork/unfiled" },
      {
        name: "Log paperwork",
        description: "As it arrives",
        pinned: true,
        href: "/paperwork/log",
      },
      {
        name: "Categories",
        description: "Categories and how long to keep",
        adminOnly: true,
        href: "/paperwork/categories",
      },
    ],
  },
  // Added in v1.0 (REQ-87); Vin chose teal and the last place on
  // 2026-09-24.
  {
    slug: "storage",
    name: "Storage",
    tokens: "storage",
    href: "/storage",
    sections: [{ name: "Add an entry", description: "Boxes and loose items", pinned: true, href: "/storage/add" }],
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
