import type { ActionItem, ModuleStatus } from "../module-status";
import type { Balance } from "./balances";
import { cashCheck } from "./balances";
import { dueDateIn } from "./bills";
import { monthLabel, monthStart, splitInForce, type Person, type Split } from "./budget-year";
import { leftovers } from "./leftover";
import { billEntered, isSquared, monthShares, monthStatus, monthTotals, type Month } from "./month";
import { formatMoney } from "./money";
import { marchReview } from "./recalibrate";

// REQ-93: what Finances puts in front of each person, worked out from the
// data every time it's asked. Nothing is ticked off by hand: an item goes
// once the thing it asks for is done (REQ-91), except the two that are
// only news — "numbers are ready" clears when opened, "cash gap" when
// acknowledged — which is what the acknowledgements are for.
//
// Every item knows where the action happens (REQ-91's deep link) and
// whether it also pushes (REQ-70). A push goes once per topic; the topic
// says what makes a second one worth sending — a new month, a new quarter,
// or, for the nudge, paying and then going quiet again.

export type FinanceItem = ActionItem & {
  href: string;
  // The label on its button on Finances home (DESIGN.md §6). "Acknowledge"
  // marks the one item that's only news and is cleared right there.
  button: string;
  // Also what an acknowledgement records, for the two items that take one.
  key: string;
  // In-app only when null. No dollar figures, ever (DESIGN.md §10).
  push: { topic: string; body: string } | null;
};

export type FinanceSnapshot = {
  today: string;
  people: Person[];
  splits: Split[];
  // How many bills the household's list holds.
  billCount: number;
  // Months opened in the last year, oldest first.
  months: Month[];
  balances: Balance[];
  acks: { user_id: string; key: string }[];
};

// Most urgent first. Due-soon and month-ended outrank the rest (REQ-93).
export const RANKS = {
  ended: 1,
  dueSoon: 2,
  noPayment: 3,
  enter: 4,
  ready: 5,
  squared: 6,
  balances: 7,
  cashGap: 8,
  recalibrate: 9,
} as const;

// How far ahead of its due date an unpaid bill shows.
export const DUE_SOON_DAYS = 5;
// How long without a payment before someone who owes is nudged.
export const QUIET_DAYS = 14;

export function financeItems(snapshot: FinanceSnapshot, viewer: string): FinanceItem[] {
  const { today, splits } = snapshot;
  const me = snapshot.people.find((person) => person.user_id === viewer);
  if (!me || !splitInForce(splits, today)) return [];
  const current = monthStart(today);
  const acked = new Set(snapshot.acks.filter((ack) => ack.user_id === viewer).map((ack) => ack.key));
  const items: FinanceItem[] = [];

  for (const month of snapshot.months) {
    if (month.closed_at || month.starts_on > current) continue;
    const shares = monthShares(month, splits, month.starts_on);
    if (shares.length === 0) continue;
    const totals = monthTotals(month, shares);
    const mine = totals.people.find((person) => person.user_id === viewer);
    const name = monthName(month.starts_on);
    const at = month.starts_on.slice(0, 7);

    if (isSquared(month, totals)) {
      items.push({
        key: `squared:${month.starts_on}`,
        text: `${name} is squared`,
        detail: "Closes tonight",
        rank: RANKS.squared,
        href: `/finances?month=${at}`,
        button: "View month",
        push: null,
      });
      continue;
    }

    // Past its last day and not squared: whoever owes pays; an admin who
    // owes nothing can close it with the balance left.
    if (month.starts_on < current) {
      const push = { topic: `ended:${month.starts_on}`, body: `${name} ended with a balance still open.` };
      if (mine && mine.outstanding > 0) {
        items.push({
          key: push.topic,
          text: `${name} ended, not squared`,
          detail: `You owe ${formatMoney(mine.outstanding)}`,
          rank: RANKS.ended,
          href: `/finances/log-payment?month=${at}`,
          button: "Log payment",
          push,
        });
      } else if (me.manages_budget) {
        items.push({
          key: push.topic,
          text: `${name} ended, not squared`,
          detail: "Close it with the balance left",
          rank: RANKS.ended,
          href: `/finances/close-month?month=${at}`,
          button: "Close month",
          push,
        });
      }
      continue;
    }

    // The month now running.
    const toEnter = month.bills.filter((bill) => !billEntered(bill)).length;
    if (toEnter > 0) {
      items.push(enterItem(month.starts_on, `${toEnter} bill${toEnter === 1 ? "" : "s"} still to enter`));
    } else {
      const enteredBy = new Set(month.bills.map((bill) => bill.entered_by).filter(Boolean));
      const key = `ready:${month.starts_on}`;
      if (enteredBy.size > 0 && !enteredBy.has(viewer) && mine && !acked.has(key)) {
        const who = snapshot.people.filter((person) => enteredBy.has(person.user_id)).map((person) => person.name);
        items.push({
          key,
          text: `${name}'s numbers are ready`,
          detail: who.length > 0 ? `Entered by ${who.join(" and ")}` : "Every bill is entered",
          rank: RANKS.ready,
          href: `/finances?month=${at}`,
          button: "View month",
          push: { topic: key, body: `${name}'s numbers are in.` },
        });
      }
    }

    for (const bill of month.bills) {
      const left = totals.bills.find((row) => row.id === bill.id)?.left ?? 0;
      if (!billEntered(bill) || left <= 0) continue;
      const [year, monthNumber] = month.starts_on.split("-").map(Number);
      const due = dueDateIn(bill.due_day, year, monthNumber);
      if (daysBetween(today, due) > DUE_SOON_DAYS) continue;
      items.push({
        key: `due:${bill.id}`,
        text: `${bill.name} ${dueWords(due, today)}`,
        detail: `${formatMoney(left)} left to pay`,
        rank: RANKS.dueSoon,
        href: `/finances/log-payment?month=${at}&bill=${bill.id}`,
        button: "Log payment",
        push: null,
      });
    }

    if (mine && mine.outstanding > 0) {
      const since = lastPaid(month, viewer) ?? month.starts_on;
      if (daysBetween(since, today) >= QUIET_DAYS) {
        items.push({
          key: `nudge:${month.starts_on}`,
          text: `No payment in ${QUIET_DAYS} days`,
          detail: `You owe ${formatMoney(mine.outstanding)} for ${name}`,
          rank: RANKS.noPayment,
          href: `/finances/log-payment?month=${at}`,
          button: "Log payment",
          push: {
            topic: `nudge:${month.starts_on}:${since}`,
            body: `You have a balance on ${name} and no payment in ${QUIET_DAYS} days.`,
          },
        });
      }
    }
  }

  // The month now running, not opened yet.
  if (snapshot.billCount > 0 && !snapshot.months.some((month) => month.starts_on === current)) {
    items.push(enterItem(current, "Open the month and enter the bills"));
  }

  const gap = cashGap(snapshot);
  if (gap && !acked.has(gap.key)) items.push(gap);

  const quarter = quarterToUpdate(today);
  if (quarter && !snapshot.balances.some((row) => row.month === quarter.month)) {
    const key = `balances:${quarter.month}`;
    items.push({
      key,
      text: "Update balances",
      detail: `Quarter ended ${monthLabel(quarter.month)}`,
      rank: RANKS.balances,
      href: `/finances/balances?month=${quarter.month.slice(0, 7)}`,
      button: "Update balances",
      // Pushed once the quarter has actually ended, not on its last day.
      push: quarter.ended ? { topic: key, body: "A quarter has ended. Time to update balances." } : null,
    });
  }

  const april = marchReview(today, splits);
  if (april && me.manages_budget) {
    const key = `recalibrate:${april}`;
    items.push({
      key,
      text: "Review the split",
      detail: `For the year from ${monthLabel(april)}`,
      rank: RANKS.recalibrate,
      href: "/finances/budget-year",
      button: "Review split",
      push: { topic: key, body: "It's March: time to review the split for April." },
    });
  }

  return items.sort((a, b) => a.rank - b.rank);
}

function enterItem(startsOn: string, detail: string): FinanceItem {
  const key = `enter:${startsOn}`;
  const name = monthName(startsOn);
  return {
    key,
    text: `Enter ${name}'s numbers`,
    detail,
    rank: RANKS.enter,
    href: `/finances/monthly-entry?month=${startsOn.slice(0, 7)}`,
    button: "Enter numbers",
    push: { topic: key, body: `Time to enter ${name}'s numbers.` },
  };
}

// Home's tile for Finances (DESIGN.md §4): loud with the most urgent item
// while there is one, otherwise the month and how it stands.
export function financeTile(snapshot: FinanceSnapshot, items: FinanceItem[]): ModuleStatus {
  if (!splitInForce(snapshot.splits, snapshot.today)) {
    return { status: "Not set up", headline: "Not set up yet", facts: [], actionItems: [] };
  }
  if (items.length > 0) {
    return { status: items[0].text, headline: items[0].text, facts: [], actionItems: items };
  }
  const current = monthStart(snapshot.today);
  const month = snapshot.months.find((row) => row.starts_on === current) ?? null;
  const shares = monthShares(month, snapshot.splits, current);
  const status = `${monthName(current)} · ${monthStatus(month, shares, snapshot.today)}`;
  return { status, headline: status, facts: [], actionItems: [] };
}

// REQ-65's flag, as an item: the newest month anyone's cash was entered
// for, if any person's cash sits more than the threshold above their
// leftover. Both see it until each acknowledges it.
function cashGap(snapshot: FinanceSnapshot): FinanceItem | null {
  const withCash = snapshot.balances.filter((row) => row.account === "cash").map((row) => row.month);
  const latest = withCash.sort().at(-1);
  const month = snapshot.months.find((row) => row.starts_on === latest);
  if (!latest || !month) return null;
  const shares = monthShares(month, snapshot.splits, latest);
  if (shares.length === 0 || month.income.length === 0) return null;
  const left = leftovers(monthTotals(month, shares), month.income).people;
  for (const person of left) {
    if (person.income <= 0) continue;
    const cash = snapshot.balances.find(
      (row) => row.month === latest && row.user_id === person.user_id && row.account === "cash",
    );
    const check = cashCheck(cash?.amount ?? null, person.leftover);
    if (!check.checked || !check.flagged) continue;
    const name = snapshot.people.find((row) => row.user_id === person.user_id)?.name ?? "Someone";
    return {
      key: `cash-gap:${latest}`,
      text: `Cash gap in ${monthName(latest)}`,
      detail: `${name}'s cash is ${formatMoney(check.gap)} above the leftover`,
      rank: RANKS.cashGap,
      href: `/finances/balances?month=${latest.slice(0, 7)}`,
      button: "Acknowledge",
      push: null,
    };
  }
  return null;
}

// The quarter-end month whose balances are due: from that month's last
// day until the end of the month after it.
export function quarterToUpdate(today: string): { month: string; ended: boolean } | null {
  const [year, month, day] = today.split("-").map(Number);
  if (month % 3 === 1) {
    const endMonth = month === 1 ? 12 : month - 1;
    const endYear = month === 1 ? year - 1 : year;
    return { month: `${endYear}-${String(endMonth).padStart(2, "0")}-01`, ended: true };
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month % 3 === 0 && day === lastDay) return { month: monthStart(today), ended: false };
  return null;
}

// The day, as the household saw it, a person last paid something in the
// month: a payment toward a bill or a one-time payment they fronted.
function lastPaid(month: Month, person: string): string | null {
  const days = [
    ...month.bills.flatMap((bill) => bill.payments)
      .filter((payment) => payment.payer_id === person)
      .map((payment) => payment.created_at.slice(0, 10)),
    ...month.direct_payments.filter((payment) => payment.payer_id === person).map((payment) => payment.paid_on),
  ];
  return days.sort().at(-1) ?? null;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

function dueWords(due: string, today: string): string {
  const days = daysBetween(today, due);
  if (days < 0) return "overdue";
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  return `due in ${days} days`;
}

function monthName(startsOn: string): string {
  return monthLabel(startsOn).split(" ")[0];
}

export type DuePush = { user_id: string; topic: string; body: string; url: string };

// REQ-70: what the hourly job sends now. Each person gets at most one push
// per run, their most urgent one not yet sent; anything else waits for a
// later hour, so a busy day arrives one at a time instead of in a burst.
export function pushesDue(snapshot: FinanceSnapshot, sent: { user_id: string; topic: string }[]): DuePush[] {
  const already = new Set(sent.map((row) => `${row.user_id} ${row.topic}`));
  return snapshot.people.flatMap((person) => {
    const next = financeItems(snapshot, person.user_id).find(
      (item) => item.push && !already.has(`${person.user_id} ${item.push.topic}`),
    );
    return next?.push ? [{ user_id: person.user_id, topic: next.push.topic, body: next.push.body, url: next.href }] : [];
  });
}
