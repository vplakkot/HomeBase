import { describe, expect, it } from "vitest";
import {
  billEntered,
  chosenMonth,
  dueInMonth,
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
  return { id: "m-1", starts_on: "2026-09-01", bills, direct_payments: direct };
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

describe("the month's status (REQ-53)", () => {
  it("is Incomplete before the month is opened", () => {
    expect(monthStatus(null)).toBe("Incomplete");
  });

  it("is Incomplete while any bill is missing, Open once all are in", () => {
    expect(monthStatus(month([rent, { ...card, amount: null }]))).toBe("Incomplete");
    expect(monthStatus(month([rent, card]))).toBe("Open");
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
