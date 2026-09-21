import type { Module } from "./modules";

// What Home says about each module: a short status line for its tile on a
// phone, a headline and two facts for its tile on a desktop, and the
// action items that need someone (docs/design/DESIGN.md §4–§5).
//
// No module has data yet, so in v0.2 this is a stand-in (REQ-82). Normally
// every module is quiet and says "Coming soon": the app shows nothing it
// doesn't know. With ?demo in the address, Home shows the invented example
// the design's mockups draw instead, so the loud and quiet states can be
// seen side by side (a Notion decision of 2026-09-21).

export type ActionItem = { text: string; detail: string };

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
// by $142", because DESIGN.md rules out spending categories.
const DEMO: Record<string, ModuleStatus> = {
  finances: {
    status: "$285 due",
    headline: "Card bill due Friday",
    facts: [
      { label: "Joint savings, projected", value: "$1,150" },
      { label: "Bills left this month", value: "$285" },
    ],
    actionItems: [{ text: "Card bill due Friday", detail: "$285 left to pay" }],
  },
  calendar: {
    status: "Dentist Thu",
    headline: "Dentist, Thu 3:00 PM",
    facts: [
      { label: "This week", value: "4 events" },
      { label: "Next shared", value: "Dinner, Sat" },
    ],
    actionItems: [],
  },
  pets: {
    status: "Pill due today",
    headline: "Heartworm pill due today",
    facts: [
      { label: "Walk", value: "5:00 PM" },
      { label: "Vet check-up", value: "12 Oct" },
    ],
    actionItems: [{ text: "Heartworm pill due", detail: "Both dogs, today" }],
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
    actionItems: [{ text: "Prescription ready", detail: "Pick up by Tuesday" }],
  },
};

export function moduleStatus(module: Module, { demo }: { demo: boolean }): ModuleStatus {
  return (demo && DEMO[module.slug]) || COMING_SOON;
}

// DESIGN.md §1: colour means "needs you". A tile is loud if and only if
// its module has at least one action item.
export function isLoud(status: ModuleStatus): boolean {
  return status.actionItems.length > 0;
}
