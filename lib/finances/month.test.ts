import { describe, expect, it } from "vitest";
import {
  billEntered,
  chosenMonth,
  dueInMonth,
  isSquared,
  monthMark,
  monthShares,
  monthStatus,
  monthTotals,
  pickableMonths,
  type Month,
  type MonthBill,
} from "./month";

const rent: MonthBill = {
  id: "mb-rent",
  name: "Rent",
  kind: "rent",
  due_day: 1,
  amount: 2000,
  personal_answer: null,
  personal_charges: [],
  payments: [],
};
const card: MonthBill = {
  id: "mb-card",
  name: "Joint card",
  kind: "card",
  due_day: 22,
  amount: 1000,
  personal_answer: "none",
  personal_charges: [],
  payments: [],
};

function month(bills: MonthBill[], direct: Month["direct_payments"] = []): Month {
  return {
    id: "m-1",
    starts_on: "2026-09-01",
    bills,
    direct_payments: direct,
    income: [],
    closed_at: null,
    closed_by: null,
    closed_automatically: false,
    split_from: null,
    people: [],
    savings: [],
  };
}

const SHARES = [
  { user_id: "u-alex", percent: 60 },
  { user_id: "u-sam", percent: 40 },
];

describe("when a bill counts as entered (REQ-53, REQ-54)", () => {
  it("needs an amount", () => {
    expect(billEntered({ ...rent, amount: null })).toBe(false);
    expect(billEntered(rent)).toBe(true);
  });

  it("needs a card statement's personal-charges question answered", () => {
    expect(billEntered({ ...card, personal_answer: null })).toBe(false);
    expect(billEntered(card)).toBe(true);
  });

  it("treats 'yes, some' with nothing declared yet as not entered", () => {
    const some = { ...card, personal_answer: "some" as const };
    expect(billEntered(some)).toBe(false);
    expect(
      billEntered({ ...some, personal_charges: [{ id: "c", owner_id: "u-sam", amount: 50, note: "" }] }),
    ).toBe(true);
  });
});

describe("the month's status (REQ-53, REQ-59)", () => {
  const TODAY = "2026-09-20";
  const paid = (bill: MonthBill, payer: string, amount: number): MonthBill => ({
    ...bill,
    payments: [...bill.payments, { id: `p-${bill.id}-${payer}`, payer_id: payer, amount, created_at: "2026-09-10" }],
  });
  // Rent $2,000 + card $1,000 = $3,000; Alex owes $1,800, Sam $1,200.
  const squared = month([paid(rent, "u-alex", 1800), paid(paid(card, "u-alex", 0.01), "u-sam", 999.99)]);
  const evenShares = month([paid(paid(rent, "u-alex", 800), "u-sam", 1200), paid(card, "u-alex", 1000)]);

  it("is Incomplete before the month is opened", () => {
    expect(monthStatus(null, SHARES, TODAY)).toBe("Incomplete");
  });

  it("is Incomplete while any bill is missing, Open once all are in", () => {
    expect(monthStatus(month([rent, { ...card, amount: null }]), SHARES, TODAY)).toBe("Incomplete");
    expect(monthStatus(month([rent, card]), SHARES, TODAY)).toBe("Open");
  });

  it("is Squared when every bill is paid in full and nobody owes anything", () => {
    expect(isSquared(evenShares, monthTotals(evenShares, SHARES))).toBe(true);
    expect(monthStatus(evenShares, SHARES, TODAY)).toBe("Squared");
  });

  it("isn't Squared while one person paid more than their share and the other less", () => {
    // Bills paid in full, but Alex paid $1,800.01 and Sam $999.99.
    expect(monthStatus(squared, SHARES, TODAY)).toBe("Open");
  });

  it("isn't Squared with a bill left to pay, or without a split", () => {
    const unpaid = month([paid(rent, "u-alex", 1800), card]);
    expect(isSquared(unpaid, monthTotals(unpaid, SHARES))).toBe(false);
    expect(isSquared(evenShares, monthTotals(evenShares, []))).toBe(false);
    expect(isSquared(month([]), monthTotals(month([]), SHARES))).toBe(false);
  });

  it("reads Ended · not squared once the month is over without squaring", () => {
    expect(monthStatus(month([rent, card]), SHARES, "2026-10-01")).toBe("Ended · not squared");
    expect(monthStatus(evenShares, SHARES, "2026-10-01")).toBe("Squared");
  });

  it("reads Closed once closed, whatever is left", () => {
    const closed = { ...month([rent, card]), closed_at: "2026-09-30T12:00:00Z", closed_by: "u-alex" };
    expect(monthStatus(closed, SHARES, "2026-10-05")).toBe("Closed");
  });
});

describe("which percentages a month uses (REQ-52)", () => {
  const splits = [
    { id: "s-oct", effective_from: "2026-10-01", note: "", shares: [{ user_id: "u-alex", percent: 50 }, { user_id: "u-sam", percent: 50 }] },
    { id: "s-sep", effective_from: "2026-09-01", note: "", shares: SHARES },
  ];

  it("an open month uses the split that had started by its first day", () => {
    expect(monthShares(month([rent]), splits, "2026-09-01")).toEqual(SHARES);
  });

  it("a closed month keeps the percentages written on it, whatever split comes later", () => {
    const closed = {
      ...month([rent]),
      closed_at: "2026-09-30T12:00:00Z",
      people: [
        { user_id: "u-alex", percent: 60, outstanding: 0 },
        { user_id: "u-sam", percent: 40, outstanding: 0 },
      ],
    };
    // Even if a new split were back-dated to September, the closed month
    // keeps 60/40 and its figures don't move.
    const later = [{ ...splits[0], effective_from: "2026-09-01" }];
    expect(monthShares(closed, later, "2026-09-01")).toEqual(SHARES);
    expect(monthTotals(closed, monthShares(closed, later, "2026-09-01")).people[0].share).toBe(1200);
  });
});

describe("the month's money", () => {
  // REQ-53: the statement entered this month plus this month's rent.
  it("counts every entered bill as the month's expenses", () => {
    expect(monthTotals(month([rent, card]), SHARES).expenses).toBe(3000);
  });

  // REQ-54: a personal charge leaves the shared base and is its owner's in full.
  it("takes personal charges out of the shared base and gives them to their owner", () => {
    const withGift = {
      ...card,
      personal_answer: "some" as const,
      personal_charges: [{ id: "c", owner_id: "u-sam", amount: 100, note: "Gift" }],
    };
    const totals = monthTotals(month([rent, withGift]), SHARES);
    expect(totals.sharedBase).toBe(2900);
    const [alex, sam] = totals.people;
    expect(alex).toMatchObject({ share: 1740, personal: 0, obligation: 1740 });
    expect(sam).toMatchObject({ share: 1160, personal: 100, obligation: 1260 });
  });

  // REQ-55: a direct payment joins the base; the other owes their share,
  // and the payer has already paid it.
  it("adds direct payments to the shared base and credits the payer", () => {
    const totals = monthTotals(
      month([rent, card], [{ id: "d", payer_id: "u-alex", amount: 50, note: "Groceries", paid_on: "2026-09-05" }]),
      SHARES,
    );
    expect(totals.sharedBase).toBe(3050);
    const [alex, sam] = totals.people;
    expect(alex).toMatchObject({ share: 1830, fronted: 50, paid: 50, outstanding: 1780 });
    expect(sam).toMatchObject({ share: 1220, fronted: 0, paid: 0, outstanding: 1220 });
  });

  // REQ-56's worked example.
  it("gives Vin 3,720 and Megan 1,280 from bills of 5,000 with 1,000 of Vin's own at 68/32", () => {
    const statement = {
      ...card,
      amount: 5000,
      personal_answer: "some" as const,
      personal_charges: [{ id: "c", owner_id: "u-vin", amount: 1000, note: "" }],
    };
    const totals = monthTotals(month([statement]), [
      { user_id: "u-vin", percent: 68 },
      { user_id: "u-megan", percent: 32 },
    ]);
    const owed = Object.fromEntries(totals.people.map((person) => [person.user_id, person.obligation]));
    expect(owed).toEqual({ "u-vin": 3720, "u-megan": 1280 });
  });

  // REQ-56: the obligations add up to the bills exactly, cent for cent,
  // even when a percentage doesn't divide evenly.
  it("makes the obligations add up to the bills exactly", () => {
    // Rounded on its own, each half of $10.05 would be $5.03: $10.06 in all.
    const halves = [
      { user_id: "u-alex", percent: 50 },
      { user_id: "u-sam", percent: 50 },
    ];
    expect(monthTotals(month([{ ...rent, amount: 10.05 }]), halves).people.map((p) => p.obligation)).toEqual([
      5.03, 5.02,
    ]);
    const thirds = [
      { user_id: "u-alex", percent: 33.33 },
      { user_id: "u-sam", percent: 66.67 },
    ];
    // Whichever order the database lists them in, the same person gets the cent.
    expect(monthTotals(month([{ ...rent, amount: 10.05 }]), [...halves].reverse()).people).toMatchObject([
      { user_id: "u-alex", obligation: 5.03 },
      { user_id: "u-sam", obligation: 5.02 },
    ]);
    for (const amount of [0.01, 0.05, 10.05, 1000.01, 1333.35]) {
      const totals = monthTotals(month([{ ...rent, amount }]), thirds);
      const owed = totals.people.reduce((total, person) => total + Math.round(person.obligation * 100), 0);
      expect(owed).toBe(Math.round(amount * 100));
    }
  });

  // REQ-57, REQ-58: a payment brings down the payer's and the bill's
  // outstanding amounts, and nobody else's.
  it("takes a payment off the payer's balance and the bill's", () => {
    const paidRent = { ...rent, payments: [{ id: "p", payer_id: "u-alex", amount: 2000, created_at: "" }] };
    const totals = monthTotals(month([paidRent, card]), SHARES);
    const [alex, sam] = totals.people;
    expect(alex).toMatchObject({ obligation: 1800, paidToBills: 2000, outstanding: -200 });
    expect(sam).toMatchObject({ obligation: 1200, paid: 0, outstanding: 1200 });
    expect(totals.bills).toEqual([
      { id: "mb-rent", total: 2000, paid: 2000, left: 0 },
      { id: "mb-card", total: 1000, paid: 0, left: 1000 },
    ]);
  });

  it("works in cents, so amounts don't drift", () => {
    const totals = monthTotals(month([{ ...rent, amount: 0.1 }, { ...card, amount: 0.2 }]), SHARES);
    expect(totals.expenses).toBe(0.3);
  });

  it("leaves bills not yet entered out", () => {
    expect(monthTotals(month([rent, { ...card, amount: null }]), SHARES).expenses).toBe(2000);
  });
});

describe("choosing the month", () => {
  const opened = ["2026-09-01", "2026-08-01"];

  it("shows an opened month that's asked for", () => {
    expect(chosenMonth("2026-08", opened, "2026-09-22")).toBe("2026-08-01");
  });

  it("falls back to the month now running for anything else", () => {
    expect(chosenMonth(undefined, opened, "2026-09-22")).toBe("2026-09-01");
    expect(chosenMonth("2026-05", opened, "2026-09-22")).toBe("2026-09-01");
    expect(chosenMonth("nonsense", opened, "2026-09-22")).toBe("2026-09-01");
  });

  it("offers the opened months and this one, newest first", () => {
    expect(pickableMonths(["2026-08-01"], "2026-09-22")).toEqual(["2026-09-01", "2026-08-01"]);
    expect(pickableMonths(opened, "2026-09-22")).toEqual(["2026-09-01", "2026-08-01"]);
  });
});

describe("dueInMonth", () => {
  it("names the day in that month", () => {
    expect(dueInMonth(1, "2026-09-01")).toBe("Due 1 Sep");
  });

  it("moves a 31st to the last day of a shorter month", () => {
    expect(dueInMonth(31, "2026-09-01")).toBe("Due 30 Sep");
    expect(dueInMonth(31, "2027-02-01")).toBe("Due 28 Feb");
  });
});

// REQ-102: the small mark after a month's title.
describe("monthMark", () => {
  it("is nothing for the month now running while it's open", () => {
    expect(monthMark(false, "2026-09-01", "2026-09-22")).toBeUndefined();
  });

  it("is Closed for the month now running once it closed early", () => {
    expect(monthMark(true, "2026-09-01", "2026-09-29")).toBe("Closed");
  });

  it("is Closed for a month gone by that closed, Open for one that never did", () => {
    expect(monthMark(true, "2026-08-01", "2026-09-22")).toBe("Closed");
    expect(monthMark(false, "2026-08-01", "2026-09-22")).toBe("Open");
  });
});
