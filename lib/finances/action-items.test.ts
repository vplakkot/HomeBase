import { describe, expect, it } from "vitest";
import {
  financeItems,
  financeTile,
  pushesDue,
  quarterToUpdate,
  RANKS,
  type FinanceItem,
  type FinanceSnapshot,
} from "./action-items";
import type { Month, MonthBill } from "./month";

// Two invented people: Alex runs the budget, Blair is a member.
const ALEX = "user-alex";
const BLAIR = "user-blair";

const rent = (over: Partial<MonthBill> = {}): MonthBill => ({
  id: "mb-rent",
  name: "Rent",
  kind: "rent",
  due_day: 1,
  amount: 2000,
  personal_answer: null,
  entered_by: null,
  personal_charges: [],
  payments: [],
  ...over,
});

const card = (over: Partial<MonthBill> = {}): MonthBill => ({
  id: "mb-card",
  name: "Joint card",
  kind: "card",
  due_day: 22,
  amount: 1000,
  personal_answer: "none",
  entered_by: ALEX,
  personal_charges: [],
  payments: [],
  ...over,
});

function month(startsOn: string, bills: MonthBill[], over: Partial<Month> = {}): Month {
  return {
    id: `m-${startsOn}`,
    starts_on: startsOn,
    bills,
    direct_payments: [],
    income: [],
    closed_at: null,
    closed_by: null,
    closed_automatically: false,
    split_from: null,
    people: [],
    savings: [],
    ...over,
  };
}

const pay = (payer: string, amount: number, on: string) => ({
  id: `p-${payer}-${on}`,
  payer_id: payer,
  amount,
  created_at: `${on}T15:00:00Z`,
});

function snapshot(over: Partial<FinanceSnapshot> = {}): FinanceSnapshot {
  return {
    today: "2026-09-10",
    people: [
      { user_id: ALEX, name: "Alex", manages_budget: true },
      { user_id: BLAIR, name: "Blair", manages_budget: false },
    ],
    splits: [
      {
        id: "split",
        effective_from: "2026-04-01",
        note: "",
        shares: [
          { user_id: ALEX, percent: 50 },
          { user_id: BLAIR, percent: 50 },
        ],
      },
    ],
    billCount: 2,
    months: [],
    balances: [],
    acks: [],
    ...over,
  };
}

const keys = (items: FinanceItem[]) => items.map((item) => item.key);
const find = (items: FinanceItem[], prefix: string) => items.find((item) => item.key.startsWith(prefix));

describe("Finances action items (REQ-93)", () => {
  it("asks both to enter the month's numbers, at Monthly entry, until every bill is entered", () => {
    const unopened = snapshot();
    for (const person of [ALEX, BLAIR]) {
      expect(find(financeItems(unopened, person), "enter:")).toMatchObject({
        text: "Enter September's numbers",
        detail: "Open the month and enter the bills",
        href: "/finances/monthly-entry?month=2026-09",
        push: { topic: "enter:2026-09-01" },
      });
    }
    const half = snapshot({ months: [month("2026-09-01", [rent(), card({ amount: null, entered_by: null })])] });
    expect(find(financeItems(half, BLAIR), "enter:")?.detail).toBe("1 bill still to enter");
    const done = snapshot({ months: [month("2026-09-01", [rent(), card()])] });
    expect(find(financeItems(done, ALEX), "enter:")).toBeUndefined();
  });

  it("tells only the person who didn't enter the numbers that they're ready, until they open the month", () => {
    const entered = snapshot({ months: [month("2026-09-01", [rent(), card({ entered_by: ALEX })])] });
    expect(find(financeItems(entered, ALEX), "ready:")).toBeUndefined();
    expect(find(financeItems(entered, BLAIR), "ready:")).toMatchObject({
      text: "September's numbers are ready",
      detail: "Entered by Alex",
      href: "/finances?month=2026-09",
      push: { topic: "ready:2026-09-01" },
    });
    const opened = { ...entered, acks: [{ user_id: BLAIR, key: "ready:2026-09-01" }] };
    expect(find(financeItems(opened, BLAIR), "ready:")).toBeUndefined();
  });

  it("shows a bill due within 5 days to both, opening Log payment on that bill, until it's paid", () => {
    const due = (today: string, bills = [rent({ payments: [pay(ALEX, 2000, "2026-09-01")] }), card()]) =>
      financeItems(snapshot({ today, months: [month("2026-09-01", bills)] }), BLAIR);
    expect(find(due("2026-09-16"), "due:mb-card")).toBeUndefined();
    expect(find(due("2026-09-17"), "due:mb-card")).toMatchObject({
      text: "Joint card due in 5 days",
      detail: "$1,000.00 left to pay",
      href: "/finances/log-payment?month=2026-09&bill=mb-card",
      push: null,
    });
    expect(find(due("2026-09-24"), "due:mb-card")?.text).toBe("Joint card overdue");
    const paid = [rent({ payments: [pay(ALEX, 2000, "2026-09-01")] }), card({ payments: [pay(BLAIR, 1000, "2026-09-18")] })];
    expect(find(due("2026-09-20", paid), "due:")).toBeUndefined();
  });

  it("nudges only the person who owes and hasn't paid for 14 days, until they pay or owe nothing", () => {
    // Alex paid on the 10th, Blair nothing; both still owe.
    const bills = [rent({ payments: [pay(ALEX, 500, "2026-09-10")] }), card()];
    const on = (today: string) => snapshot({ today, months: [month("2026-09-01", bills)] });
    expect(find(financeItems(on("2026-09-14"), BLAIR), "nudge:")).toBeUndefined();
    expect(find(financeItems(on("2026-09-15"), BLAIR), "nudge:")).toMatchObject({
      text: "No payment in 14 days",
      href: "/finances/log-payment?month=2026-09",
      push: { topic: "nudge:2026-09-01:2026-09-01" },
    });
    expect(find(financeItems(on("2026-09-15"), ALEX), "nudge:")).toBeUndefined();
    expect(find(financeItems(on("2026-09-24"), ALEX), "nudge:")?.push?.topic).toBe("nudge:2026-09-01:2026-09-10");
  });

  it("sends a month that ended unsquared to the admin to close and the person who owes to pay", () => {
    // August: Alex paid their half of the rent, Blair nothing.
    const august = month("2026-08-01", [rent({ payments: [pay(ALEX, 1000, "2026-08-03")] })]);
    const s = snapshot({ today: "2026-09-02", months: [august] });
    expect(find(financeItems(s, ALEX), "ended:")).toMatchObject({
      text: "August ended, not squared",
      detail: "Close it with the balance left",
      href: "/finances?month=2026-08",
      rank: RANKS.ended,
      push: { topic: "ended:2026-08-01" },
    });
    expect(find(financeItems(s, BLAIR), "ended:")).toMatchObject({
      detail: "You owe $1,000.00",
      href: "/finances/log-payment?month=2026-08",
      push: { topic: "ended:2026-08-01" },
    });
    const closed = snapshot({ today: "2026-09-02", months: [{ ...august, closed_at: "2026-09-02T04:00:00Z" }] });
    expect(find(financeItems(closed, ALEX), "ended:")).toBeUndefined();
  });

  it("tells both a squared month closes tonight, without a push", () => {
    const squared = month("2026-09-01", [rent({ payments: [pay(ALEX, 1000, "2026-09-02"), pay(BLAIR, 1000, "2026-09-03")] })]);
    for (const person of [ALEX, BLAIR]) {
      expect(find(financeItems(snapshot({ months: [squared] }), person), "squared:")).toMatchObject({
        text: "September is squared",
        detail: "Closes tonight",
        push: null,
      });
    }
  });

  it("flags a cash gap to both at Balances, until each acknowledges it", () => {
    const september = month("2026-09-01", [rent()], {
      income: [{ id: "i", owner_id: BLAIR, kind: "paycheck", amount: 3000, received_on: "2026-09-05", income_source_id: null, note: "" }],
    });
    // Blair's leftover is 3000 − 1000 = 2000; 2601 in cash is 601 over.
    const balances = [{ month: "2026-09-01", user_id: BLAIR, account: "cash" as const, amount: 2601 }];
    const s = snapshot({ months: [september], balances, acks: [{ user_id: ALEX, key: "cash-gap:2026-09-01" }] });
    expect(find(financeItems(s, BLAIR), "cash-gap:")).toMatchObject({
      text: "Cash gap in September",
      detail: "Blair's cash is $601.00 above the leftover",
      href: "/finances/balances?month=2026-09",
      push: null,
    });
    expect(find(financeItems(s, ALEX), "cash-gap:")).toBeUndefined();
  });

  it("asks both to update balances at quarter end, pushing once the quarter is over", () => {
    expect(find(financeItems(snapshot({ today: "2026-09-30" }), BLAIR), "balances:")).toMatchObject({
      href: "/finances/balances?month=2026-09",
      push: null,
    });
    expect(find(financeItems(snapshot({ today: "2026-10-05" }), BLAIR), "balances:")?.push?.topic).toBe(
      "balances:2026-09-01",
    );
    const entered = [{ month: "2026-09-01", user_id: ALEX, account: "cash" as const, amount: 10 }];
    expect(find(financeItems(snapshot({ today: "2026-10-05", balances: entered }), BLAIR), "balances:")).toBeUndefined();
    expect(quarterToUpdate("2026-11-01")).toBeNull();
    expect(quarterToUpdate("2027-01-03")).toEqual({ month: "2026-12-01", ended: true });
  });

  it("asks the admin, from 1 March, to review the split until April's is saved", () => {
    const march = snapshot({ today: "2027-03-01" });
    expect(find(financeItems(march, ALEX), "recalibrate:")).toMatchObject({
      href: "/finances/budget-year",
      push: { topic: "recalibrate:2027-04-01" },
    });
    expect(find(financeItems(march, BLAIR), "recalibrate:")).toBeUndefined();
    const saved = snapshot({
      today: "2027-03-10",
      splits: [...march.splits, { id: "next", effective_from: "2027-04-01", note: "", shares: march.splits[0].shares }],
    });
    expect(find(financeItems(saved, ALEX), "recalibrate:")).toBeUndefined();
  });

  it("ranks month-ended and due-soon above everything else", () => {
    const august = month("2026-08-01", [rent({ payments: [pay(ALEX, 1000, "2026-08-03")] })]);
    const september = month("2026-09-01", [rent(), card({ amount: null, entered_by: null })]);
    const september2 = month("2026-09-01", [rent({ due_day: 12 }), card()]);
    const items = financeItems(snapshot({ today: "2026-09-10", months: [august, september] }), BLAIR);
    expect(keys(items).slice(0, 1)).toEqual(["ended:2026-08-01"]);
    const due = financeItems(snapshot({ today: "2026-09-10", months: [september2] }), BLAIR);
    expect(due[0].key).toBe("due:mb-rent");
    expect(due.every((item, i) => i === 0 || item.rank >= due[i - 1].rank)).toBe(true);
  });

  it("gives nothing before Finances is set up", () => {
    expect(financeItems(snapshot({ splits: [] }), ALEX)).toEqual([]);
    expect(financeTile(snapshot({ splits: [] }), []).status).toBe("Not set up");
  });
});

describe("Finances pushes (REQ-70)", () => {
  // Every moment REQ-70 names, in one place.
  const moments = [
    snapshot(),
    snapshot({ months: [month("2026-09-01", [rent(), card()])] }),
    snapshot({ today: "2026-09-15", months: [month("2026-09-01", [rent(), card()])] }),
    snapshot({ today: "2026-09-02", months: [month("2026-08-01", [rent()])] }),
    snapshot({ today: "2027-03-01" }),
    snapshot({ today: "2026-10-01" }),
  ];

  it("never puts a dollar figure in a push", () => {
    const bodies = moments.flatMap((s) =>
      [ALEX, BLAIR].flatMap((person) => financeItems(s, person).flatMap((item) => (item.push ? [item.push.body] : []))),
    );
    expect(bodies.length).toBeGreaterThan(6);
    for (const body of bodies) expect(body).not.toMatch(/\$|\d+\.\d\d/);
  });

  it("sends each person their most urgent unsent push, once", () => {
    const s = snapshot({ today: "2026-09-02", months: [month("2026-08-01", [rent()])] });
    const first = pushesDue(s, []);
    expect(first.map((push) => [push.user_id, push.topic])).toEqual([
      [ALEX, "ended:2026-08-01"],
      [BLAIR, "ended:2026-08-01"],
    ]);
    expect(first[1].url).toBe("/finances/log-payment?month=2026-08");
    const second = pushesDue(s, first);
    expect(second.map((push) => push.topic)).toEqual(["enter:2026-09-01", "enter:2026-09-01"]);
    expect(pushesDue(s, [...first, ...second])).toEqual([]);
  });

  it("sends no more than two pushes to anyone in a steady month", () => {
    // September, day by day: opened on the 1st, Alex enters on the 3rd,
    // both pay their halves within a fortnight, the card is paid by its due day.
    const sent: { user_id: string; topic: string }[] = [];
    for (let day = 1; day <= 30; day++) {
      const today = `2026-09-${String(day).padStart(2, "0")}`;
      const entered = day >= 3;
      const bills = [
        rent({ payments: day >= 5 ? [pay(ALEX, 1000, "2026-09-05"), pay(BLAIR, 1000, "2026-09-05")] : [] }),
        card({
          amount: entered ? 1000 : null,
          entered_by: entered ? ALEX : null,
          payments: day >= 12 ? [pay(ALEX, 500, "2026-09-12"), pay(BLAIR, 500, "2026-09-12")] : [],
        }),
      ];
      const s = snapshot({
        today,
        months: [month("2026-09-01", bills)],
        balances: [{ month: "2026-08-01", user_id: ALEX, account: "cash", amount: 1 }],
      });
      // The job runs every hour; twelve waking runs a day.
      for (let run = 0; run < 12; run++) sent.push(...pushesDue(s, sent));
    }
    for (const person of [ALEX, BLAIR]) {
      expect(sent.filter((row) => row.user_id === person).length).toBeLessThanOrEqual(2);
    }
    expect(sent.map((row) => `${row.user_id} ${row.topic}`)).toEqual([
      `${ALEX} enter:2026-09-01`,
      `${BLAIR} enter:2026-09-01`,
      `${BLAIR} ready:2026-09-01`,
    ]);
  });
});
