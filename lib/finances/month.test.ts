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
};
const card: MonthBill = {
  id: "mb-card",
  name: "Joint card",
  kind: "card",
  due_day: 22,
  amount: 1000,
  personal_answer: "none",
  personal_charges: [],
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
      month([rent, card], [{ id: "d", payer_id: "u-alex", amount: 50, note: "Groceries" }]),
      SHARES,
    );
    expect(totals.sharedBase).toBe(3050);
    const [alex, sam] = totals.people;
    expect(alex).toMatchObject({ share: 1830, fronted: 50 });
    expect(sam).toMatchObject({ share: 1220, fronted: 0 });
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
