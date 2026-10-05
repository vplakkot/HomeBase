import Link from "next/link";
import { pageOf, statusOf, summarise, type LogRow } from "../../lib/notifications/log";
import { LocalTime } from "./local-time";

// REQ-22. The log itself. A server component: it only renders what the
// page already read, so there is nothing to do in the browser.

const LABELS: Record<ReturnType<typeof statusOf>, string> = {
  tapped: "Tapped",
  delivered: "Delivered",
  waiting: "Waiting",
  missing: "Missing",
  refused: "Refused",
};

// What sent it. The hourly test stopped on 2026-09-24; its rows keep their name.
const TRIGGERS: Record<LogRow["trigger"], string> = {
  hourly: "Hourly test",
  manual: "By hand",
  finances: "Finances",
  "meal-plan": "Meal Plan",
};

export function NotificationLog({
  rows,
  names,
  now,
  page = 1,
}: {
  // null means the log could not be read. Deliberately different from an
  // empty log, which means nothing has been sent.
  rows: LogRow[] | null;
  // user_id → what to call them.
  names: Map<string, string>;
  // Passed in rather than read here, so the table is the same wherever
  // it's rendered and a test can fix the clock.
  now: number;
  // REQ-126: which page of the log to show, 25 rows to a page.
  page?: number;
}) {
  if (rows === null) {
    return (
      <p>
        The log could not be read. Everything else on this page still
        works, and nothing has stopped sending &mdash; only the record of it
        is unavailable. If this persists, the reason will be in the
        server logs.
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p>
        Nothing sent in the last 7 days. Finances reminders fill this in as
        they go; &ldquo;Send test now&rdquo; above fills it in immediately.
      </p>
    );
  }

  // The summary covers the whole window; only the table is paged.
  const totals = summarise(rows, now);
  const shown = pageOf(rows, page);

  return (
    <>
      <p>
        {totals.sent} sent, {totals.arrived} arrived
        {totals.missing > 0 ? `, ${totals.missing} missing` : ""}
        {totals.refused > 0 ? `, ${totals.refused} refused` : ""}
        {totals.waiting > 0 ? `, ${totals.waiting} still waiting` : ""}
        {totals.reliability === null
          ? ""
          : ` — ${totals.reliability}% of the ones we have an answer for`}
        .
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Sent</th>
            <th scope="col">Who</th>
            <th scope="col">Device</th>
            <th scope="col">Trigger</th>
            <th scope="col">Status</th>
            <th scope="col">Arrived</th>
          </tr>
        </thead>
        <tbody>
          {shown.rows.map((row) => {
            const status = statusOf(row, now);
            return (
              <tr key={row.id}>
                <td>
                  <LocalTime value={row.sent_at} />
                </td>
                <td>{names.get(row.user_id) ?? "Former member"}</td>
                {/* A fingerprint, not the address the phone is reached at. */}
                <td>
                  <code>{row.device}</code>
                </td>
                <td>{TRIGGERS[row.trigger]}</td>
                <td>
                  {LABELS[status]}
                  {status === "refused" && row.failure_code
                    ? ` (${row.failure_code})`
                    : ""}
                </td>
                <td>{row.delivered_at ? <LocalTime value={row.delivered_at} /> : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {shown.pages > 1 ? (
        <nav aria-label="Log pages">
          {shown.page > 1 ? <Link href={`/admin?page=${shown.page - 1}`}>Previous</Link> : null}{" "}
          <span aria-current="page">
            Page {shown.page} of {shown.pages}
          </span>{" "}
          {shown.page < shown.pages ? <Link href={`/admin?page=${shown.page + 1}`}>Next</Link> : null}
        </nav>
      ) : null}
    </>
  );
}
