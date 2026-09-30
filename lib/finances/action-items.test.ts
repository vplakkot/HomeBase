import { describe, expect, it } from "vitest";
import {
  financeItems,
  financeTile,
  itemMonth,
  itemsForMonth,
  pushesDue,
  quarterToUpdate,
  RANKS,
  type FinanceItem,
  type FinanceSnapshot,
} from "./action-items";
import { threePaycheckMonths, type IncomeSource } from "./income";
import type { Month, MonthBill, MonthIncome } from "./month";

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
    added_later: false,
    settled: false,
    own_shares: [],
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
    income: [],
    ...over,
  };
}

// Invented pay schedules. Alex's anchor gives three paydays in October
// 2026 (2, 16, 30), Blair's in January 2027 (1, 15, 29).
const source = (owner: string, anchor: string, over: Partial<IncomeSource> = {}) => ({
  id: `src-${owner}`,
  name: "",
  owner_id: owner,
  net_amount: 600,
  cadence: "biweekly" as const,
  anchor_date: anchor,
  ended_on: null,
  effective_from: "2026-01-01",
  ...over,
});
const ALEX_PAY = source(ALEX, "2026-08-07");
const BLAIR_PAY = source(BLAIR, "2026-09-11");

const logged = (owner: string, amount: number): MonthIncome => ({
  id: `i-${owner}`,
  owner_id: owner,
  kind: "paycheck",
  amount,
  received_on: "2026-09-05",
  income_source_id: null,
  note: "",
});

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
      href: "/finances/close-month?month=2026-08",
      button: "Close month",
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

  it("warns both when someone's share is more than their income, until each acknowledges it", () => {
    // Rent 2000 split 50/50: 1000 each. Alex has 500 in, Blair 3000.
    const september = month("2026-09-01", [rent()], { income: [logged(ALEX, 500), logged(BLAIR, 3000)] });
    const s = snapshot({ months: [september] });
    expect(find(financeItems(s, ALEX), "over:")).toMatchObject({
      key: `over:2026-09-01:${ALEX}`,
      text: "You'll be over budget",
      detail: "September's share is $500.00 more than income",
      href: "/finances/balances?month=2026-09",
      button: "Acknowledge",
      push: null,
    });
    expect(find(financeItems(s, BLAIR), "over:")?.text).toBe("Alex will be over budget");
    expect(find(financeItems(s, ALEX), "household-over:")).toBeUndefined();
    // Blair acknowledging clears it for Blair only.
    const acked = snapshot({ months: [september], acks: [{ user_id: BLAIR, key: `over:2026-09-01:${ALEX}` }] });
    expect(find(financeItems(acked, BLAIR), "over:")).toBeUndefined();
    expect(find(financeItems(acked, ALEX), "over:")).toBeDefined();
  });

  it("counts the paychecks the month still expects, so nobody looks over budget early", () => {
    // Alex's schedule pays 600 on 4 and 18 September: 500 + 1200 covers 1000.
    const september = month("2026-09-01", [rent()], { income: [logged(ALEX, 500), logged(BLAIR, 3000)] });
    const s = snapshot({ months: [september], income: [source(ALEX, "2026-09-04")] });
    expect(find(financeItems(s, ALEX), "over:")).toBeUndefined();
    // And no income at all set up or logged is no warning either.
    expect(find(financeItems(snapshot({ months: [month("2026-09-01", [rent()])] }), ALEX), "over:")).toBeUndefined();
  });

  it("warns both of a household loss month alongside each person over, each item acknowledged separately", () => {
    const september = month("2026-09-01", [rent()], { income: [logged(ALEX, 500), logged(BLAIR, 500)] });
    const s = snapshot({ months: [september] });
    for (const person of [ALEX, BLAIR]) {
      const items = financeItems(s, person);
      expect(find(items, "household-over:")).toMatchObject({
        text: "Household over budget",
        detail: "September's bills are $1,000.00 more than our income",
        button: "Acknowledge",
        push: null,
      });
      expect(items.filter((item) => item.key.startsWith("over:"))).toHaveLength(2);
    }
    const acked = snapshot({ months: [september], acks: [{ user_id: ALEX, key: "household-over:2026-09-01" }] });
    expect(find(financeItems(acked, ALEX), "household-over:")).toBeUndefined();
    expect(find(financeItems(acked, BLAIR), "household-over:")).toBeDefined();
  });

  it("tells only the earner, in the last week of the month before, that a three-paycheck month is next", () => {
    const income = [ALEX_PAY, BLAIR_PAY];
    const item = (today: string, viewer: string) =>
      find(financeItems(snapshot({ today, income }), viewer), "three-pay:");
    expect(item("2026-09-24", ALEX)).toMatchObject({
      key: `three-pay:2026-10-01:${ALEX_PAY.id}`,
      text: "Three-paycheck month next",
      detail: "October brings three paychecks",
      href: "/finances/income",
      push: null,
    });
    expect(item("2026-09-30", ALEX)).toBeDefined();
    // Not before the last week, and gone once October starts.
    expect(item("2026-09-23", ALEX)).toBeUndefined();
    expect(item("2026-10-01", ALEX)).toBeUndefined();
    // Blair's three-paycheck month is January, and it's not Alex's.
    expect(item("2026-09-24", BLAIR)).toBeUndefined();
    expect(item("2026-12-27", BLAIR)).toBeDefined();
    expect(item("2026-12-27", ALEX)).toBeUndefined();
    // An ended source says nothing.
    const ended = snapshot({ today: "2026-09-24", income: [{ ...ALEX_PAY, ended_on: "2026-09-20" }] });
    expect(find(financeItems(ended, ALEX), "three-pay:")).toBeUndefined();
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

  // Vin, 2026-09-29: the tile named only the top item of several.
  it("names the item on Finances' tile when there is one, and says 'Multiple action items' for several", () => {
    const one = { text: "Rent overdue" } as FinanceItem;
    const two = { text: "April isn't finished" } as FinanceItem;
    expect(financeTile(snapshot({}), [one]).status).toBe("Rent overdue");
    expect(financeTile(snapshot({}), [one, two]).status).toBe("Multiple action items");
    expect(financeTile(snapshot({}), [one, two]).headline).toBe("Multiple action items");
  });

  it("gives nothing before Finances is set up", () => {
    expect(financeItems(snapshot({ splits: [] }), ALEX)).toEqual([]);
    expect(financeTile(snapshot({ splits: [] }), []).status).toBe("Not set up");
  });
});

describe("Three-paycheck months (REQ-62)", () => {
  it("finds the months a biweekly source pays three times, from its anchor", () => {
    expect(threePaycheckMonths(ALEX_PAY, "2026-09-01", 12)).toEqual(["2026-10-01", "2027-04-01"]);
    expect(threePaycheckMonths(BLAIR_PAY, "2026-09-01", 12)).toEqual(["2027-01-01", "2027-07-01"]);
    // A different anchor moves them: nothing is fixed to a month.
    expect(threePaycheckMonths(source(ALEX, "2026-08-14"), "2026-09-01", 3)).toEqual([]);
  });

  it("only counts sources paid every two weeks", () => {
    expect(threePaycheckMonths(source(ALEX, "2026-08-07", { cadence: "weekly" }), "2026-09-01", 12)).toEqual([]);
    expect(threePaycheckMonths(source(ALEX, "2026-08-07", { cadence: "monthly" }), "2026-09-01", 12)).toEqual([]);
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

// REQ-148, as changed by Vin on 2026-09-28: a month filled in afterwards
// raises none of the usual items and pushes nothing, but while it's open
// it has one item of its own, to finish it.
describe("a month added later", () => {
  const owing = month("2026-05-01", [rent({ entered_by: null }), card({ amount: null, personal_answer: null })], {
    added_later: true,
  });
  const ended = month("2026-06-01", [rent({ payments: [pay(ALEX, 500, "2026-06-03")] })], { added_later: true });
  const settled = month("2026-07-01", [rent()], { added_later: true, closed_at: "2026-09-20T12:00:00Z", settled: true });
  const september = month("2026-09-01", [rent({ payments: [pay(ALEX, 1000, "2026-09-01"), pay(BLAIR, 1000, "2026-09-01")] })]);
  const s = snapshot({ today: "2026-09-10", months: [owing, ended, settled, september] });

  it("shows one item per open month until it's finished, and none once closed", () => {
    for (const viewer of [ALEX, BLAIR]) {
      const items = financeItems(s, viewer).filter((item) => /2026-0[567]/.test(item.key));
      expect(items.map((item) => [item.text, item.detail, item.href, item.button])).toEqual([
        ["May 2026 isn't finished", "1 bill still to enter", "/finances/monthly-entry?month=2026-05", "Finish month"],
        ["June 2026 isn't finished", "Mark it settled, or log payments", "/finances/monthly-entry?month=2026-06", "Finish month"],
      ]);
    }
  });

  it("sends no notifications", () => {
    expect(pushesDue(s, []).filter((push) => /2026-0[567]/.test(push.topic))).toEqual([]);
    expect(financeItems(s, ALEX).filter((item) => item.key.startsWith("unfinished:")).every((item) => item.push === null)).toBe(true);
    // The same months, not added later, would have raised the usual items.
    const plain = snapshot({ months: [{ ...owing, added_later: false }, { ...ended, added_later: false }] });
    expect(financeItems(plain, ALEX).some((item) => item.key === "ended:2026-06-01")).toBe(true);
  });
});

// Vin, 2026-09-28: Finances home on April shows April's items only.
describe("items for the month on screen", () => {
  const item = (href: string) => ({ href }) as FinanceItem;
  const items = [
    item("/finances/log-payment?month=2026-09&bill=b-1"),
    item("/finances/monthly-entry?month=2026-04"),
    item("/finances/budget-year"),
    item("/finances?month=2026-04"),
  ];

  it("reads an item's month from its link", () => {
    expect(itemMonth(items[0])).toBe("2026-09-01");
    expect(itemMonth(items[2])).toBeNull();
  });

  it("shows a month gone by only its own items, and the month now running all of them", () => {
    expect(itemsForMonth(items, "2026-04-01", "2026-09-28")).toEqual([items[1], items[3]]);
    expect(itemsForMonth(items, "2026-05-01", "2026-09-28")).toEqual([]);
    expect(itemsForMonth(items, "2026-09-01", "2026-09-28")).toEqual(items);
  });
});
