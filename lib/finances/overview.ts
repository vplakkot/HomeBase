import { dueDateIn } from "./bills";
import { householdToday } from "./budget-year";
import { billEntered, type Month, type MonthTotals } from "./month";

// What Finances home shows about a month (DESIGN.md §7, REQ-103): the
// summary — still to pay, the bills, paid so far, how much of it is paid
// and how many bills are late — and one row per bill with its due date
// and progress. Worked out from monthTotals, so the figures agree with
// Outstanding balances.

export type OverviewBill = {
  id: string;
  name: string;
  due: string;
  overdue: boolean;
  entered: boolean;
  total: number;
  paid: number;
  left: number;
};

export type MonthSummary = {
  stillToPay: number;
  bills: number;
  paid: number;
  // Whole percent of the bills paid, 0 while there's nothing to pay.
  percentPaid: number;
  overdue: number;
  rows: OverviewBill[];
};

export function monthSummary(month: Month, totals: MonthTotals, today: string): MonthSummary {
  const [year, monthNumber] = month.starts_on.split("-").map(Number);
  const rows = month.bills.map((bill) => {
    const money = totals.bills.find((row) => row.id === bill.id);
    const entered = billEntered(bill);
    const due = dueDateIn(bill.due_day, year, monthNumber);
    const left = entered ? Math.max(money?.left ?? 0, 0) : 0;
    return {
      id: bill.id,
      name: bill.name,
      due,
      // A closed month has nothing late: it's settled as it stands.
      overdue: !month.closed_at && entered && left > 0 && due < today,
      entered,
      total: entered ? (money?.total ?? 0) : 0,
      paid: money?.paid ?? 0,
      left,
    };
  });
  const bills = rows.reduce((sum, row) => sum + row.total, 0);
  const paid = rows.reduce((sum, row) => sum + Math.min(row.paid, row.total), 0);
  return {
    stillToPay: rows.reduce((sum, row) => sum + row.left, 0),
    bills,
    paid,
    percentPaid: bills > 0 ? Math.floor((paid / bills) * 100) : 0,
    overdue: rows.filter((row) => row.overdue).length,
    rows,
  };
}

// How far along a progress bar is, as a whole percent from 0 to 100.
export function progress(part: number, whole: number): number {
  if (whole <= 0) return part > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.floor((part / whole) * 100)));
}

// REQ-104: every payment logged in a month, newest first — payments
// against a bill (Log payment) and One-time Payments someone fronted,
// which read "Direct payment". A bill payment is dated the day it was
// logged, household time; a one-time payment the day it was paid.
export type PaymentLine = {
  id: string;
  on: string;
  payerId: string;
  toward: string;
  amount: number;
};

export function paymentsMade(month: Month): PaymentLine[] {
  const lines: (PaymentLine & { sortKey: string })[] = [];
  for (const bill of month.bills) {
    for (const payment of bill.payments) {
      lines.push({
        id: payment.id,
        on: householdToday(new Date(payment.created_at)),
        payerId: payment.payer_id,
        toward: bill.name,
        amount: payment.amount,
        sortKey: payment.created_at,
      });
    }
  }
  for (const payment of month.direct_payments) {
    lines.push({
      id: payment.id,
      on: payment.paid_on,
      payerId: payment.payer_id,
      toward: "Direct payment",
      amount: payment.amount,
      sortKey: payment.paid_on,
    });
  }
  return lines
    .sort((a, b) => (a.on === b.on ? b.sortKey.localeCompare(a.sortKey) : b.on.localeCompare(a.on)))
    .map(({ sortKey: _sortKey, ...line }) => line);
}
