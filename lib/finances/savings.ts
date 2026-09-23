import type { Leftover } from "./leftover";
import { formatMoney } from "./money";

// What the month allows into joint savings (REQ-63, REQ-64). The tighter
// month sets the pace: each person puts in half of the lower leftover,
// rounded down to the dollar, so both put in the same. What remains of
// each leftover is that person's own. If anyone has nothing left, or
// less, nobody saves jointly this month.

export type SavingsPlan = {
  // Dollars each person puts into joint; 0 when there's nothing to save.
  each: number;
  // All of it together.
  joint: number;
  people: { user_id: string; toJoint: number; yours: number; leftover: number }[];
};

export function savingsPlan(people: Leftover[]): SavingsPlan {
  const lowest = people.length > 0 ? Math.min(...people.map((person) => person.leftover)) : 0;
  const each = lowest > 0 ? Math.floor(lowest / 2) : 0;
  return {
    each,
    joint: each * people.length,
    people: people.map((person) => ({
      user_id: person.user_id,
      toJoint: each,
      yours: each > 0 ? Math.round((person.leftover - each) * 100) / 100 : Math.max(person.leftover, 0),
      leftover: person.leftover,
    })),
  };
}

// One line per person saying why there's nothing to save, in words
// (REQ-64). A shortfall came out of that person's savings.
export function nothingToSaveReasons(plan: SavingsPlan, nameOf: (userId: string) => string): string[] {
  const lowest = Math.min(...plan.people.map((person) => person.leftover));
  return plan.people.flatMap((person) => {
    const name = nameOf(person.user_id);
    if (person.leftover < 0) {
      return [`${name}'s income didn't cover their share: ${formatMoney(-person.leftover)} came out of savings.`];
    }
    if (person.leftover === 0) return [`${name} has nothing left after their share.`];
    if (lowest > 0 && person.leftover === lowest) {
      return [`${name} has under $2 left, not enough to split.`];
    }
    return [];
  });
}

// What was actually put away in a month (REQ-66): per person, into joint
// and on their own.
export type RecordedSavings = { user_id: string; to_joint: number; own: number };
