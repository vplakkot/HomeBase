import type { Module } from "./modules";

// What Home says about each module: a short status line for its tile on a
// phone, a headline and two facts for its tile on a desktop, and the
// action items that need someone (docs/design/DESIGN.md §4–§5).
//
// A module with data says what it knows (Finances, from REQ-93); every
// other module is quiet and says "Coming soon": the app shows nothing it
// doesn't know. With ?demo in the address, Home shows the invented example
// the design's mockups draw instead, so the loud and quiet states can be
// seen side by side (a Notion decision of 2026-09-21).

// Where the item comes in urgency order across all modules: 1 is the most
// urgent. Home shows the three with the lowest ranks (DESIGN.md §5).
// href: where tapping it goes, the exact screen where the action happens
// (REQ-91); the design's example items have none.
export type ActionItem = { text: string; detail: string; rank: number; href?: string };

export type Fact = { label: string; value: string };

export type ModuleStatus = {
  status: string;
  headline: string;
  // Two on a desktop tile, or none while the module has nothing to report.
  facts: readonly Fact[];
  actionItems: readonly ActionItem[];
};

const COMING_SOON: ModuleStatus = {
  status: "Coming soon",
  headline: "Coming soon",
  facts: [],
  actionItems: [],
};

// The mockups' three-item example (home-phone-3-actions and
// home-desktop-3-actions): Finances, Pets and Health need someone, the
// rest are calm. Finances' item differs from the mockup's "Groceries over
// by $142", because DESIGN.md rules out spending categories. Calendar's
// item is a fourth, shown only with ?demo=4, where it makes Calendar loud
// but is too far down to reach the card.
const DEMO: Record<string, ModuleStatus> = {
  finances: {
    status: "$285 due",
    headline: "Card bill due Friday",
    facts: [
      { label: "Joint savings, projected", value: "$1,150" },
      { label: "Bills left this month", value: "$285" },
    ],
    actionItems: [{ text: "Card bill due Friday", detail: "$285 left to pay", rank: 1 }],
  },
  calendar: {
    status: "Dentist Thu",
    headline: "Dentist, Thu 3:00 PM",
    facts: [
      { label: "This week", value: "4 events" },
      { label: "Next shared", value: "Dinner, Sat" },
    ],
    actionItems: [{ text: "Confirm the dentist", detail: "Thu 3:00 PM", rank: 4 }],
  },
  pets: {
    status: "Pill due today",
    headline: "Heartworm pill due today",
    facts: [
      { label: "Walk", value: "5:00 PM" },
      { label: "Vet check-up", value: "12 Oct" },
    ],
    actionItems: [{ text: "Heartworm pill due", detail: "Both dogs, today", rank: 2 }],
  },
  wine: {
    status: "9 bottles",
    headline: "9 bottles on the rack",
    facts: [
      { label: "Opened this month", value: "3" },
      { label: "Running low", value: "Red blends" },
    ],
    actionItems: [],
  },
  "meal-plans": {
    status: "Tacos tonight",
    headline: "Tacos tonight",
    facts: [
      { label: "Planned this week", value: "5 of 7" },
      { label: "Shopping list", value: "11 items" },
    ],
    actionItems: [],
  },
  health: {
    status: "Refill ready",
    headline: "Prescription ready",
    facts: [
      { label: "Pick up by", value: "Tuesday" },
      { label: "Next appointment", value: "2 Oct" },
    ],
    actionItems: [{ text: "Prescription ready", detail: "Pick up by Tuesday", rank: 3 }],
  },
};

// How much of the example Home shows: null normally, or with ?demo how
// many of its action items, most urgent first. Plain ?demo is the
// mockups' three; ?demo=0 to ?demo=4 show every state the card has, from
// All clear to more items than fit.
export type Demo = number | null;

const DEMO_ITEMS = 3;
const MOST_DEMO_ITEMS = 4;

export function demoFrom(param: string | string[] | undefined): Demo {
  const value = Array.isArray(param) ? param[0] : param;
  if (value === undefined) return null;
  if (!/^\d+$/.test(value)) return DEMO_ITEMS;
  return Math.min(Number(value), MOST_DEMO_ITEMS);
}

export function moduleStatus(
  module: Module,
  demo: Demo,
  live: Partial<Record<string, ModuleStatus>> = {},
): ModuleStatus {
  const example = DEMO[module.slug];
  if (demo === null) return live[module.slug] ?? COMING_SOON;
  if (!example) return COMING_SOON;
  return { ...example, actionItems: example.actionItems.filter((item) => item.rank <= demo) };
}

// The action items Home shows: across the given modules, the three most
// urgent, most urgent first (DESIGN.md §5).
export function mostUrgent(
  statuses: readonly { module: Module; status: ModuleStatus }[],
): { module: Module; item: ActionItem }[] {
  return statuses
    .flatMap(({ module, status }) => status.actionItems.map((item) => ({ module, item })))
    .sort((a, b) => a.item.rank - b.item.rank)
    .slice(0, 3);
}

// DESIGN.md §1: colour means "needs you". A tile is loud if and only if
// its module has at least one action item.
export function isLoud(status: ModuleStatus): boolean {
  return status.actionItems.length > 0;
}
