import { statusOf, summarise, type LogRow } from "../../lib/notifications/log";

// REQ-22. The log itself. A server component: it only renders what the
// page already read, so there is nothing to do in the browser.

const LABELS: Record<ReturnType<typeof statusOf>, string> = {
  tapped: "Tapped",
  delivered: "Delivered",
  waiting: "Waiting",
  missing: "Missing",
  refused: "Refused",
};

function when(value: string) {
  // Fixed format rather than the visitor's locale: this table is read by
  // one household, and a server and a browser disagreeing on the format
  // would make React complain.
  return new Date(value).toISOString().replace("T", " ").slice(0, 16);
}

export function NotificationLog({
  rows,
  names,
  now,
}: {
  // null means the log could not be read. Deliberately different from an
  // empty log, which means nothing has been sent.
  rows: LogRow[] | null;
  // user_id → what to call them.
  names: Map<string, string>;
  // Passed in rather than read here, so the table is the same wherever
  // it's rendered and a test can fix the clock.
  now: number;
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
        Nothing sent in the last 7 days. The hourly test should fill this in
        on its own; &ldquo;Send test now&rdquo; above fills it in immediately.
      </p>
    );
  }

  const totals = summarise(rows, now);

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
            <th scope="col">Sent (UTC)</th>
            <th scope="col">Who</th>
            <th scope="col">Device</th>
            <th scope="col">Trigger</th>
            <th scope="col">Status</th>
            <th scope="col">Arrived (UTC)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const status = statusOf(row, now);
            return (
              <tr key={row.id}>
                <td>{when(row.sent_at)}</td>
                <td>{names.get(row.user_id) ?? "Former member"}</td>
                {/* A fingerprint, not the address the phone is reached at. */}
                <td>
                  <code>{row.device}</code>
                </td>
                <td>{row.trigger === "hourly" ? "Hourly" : "By hand"}</td>
                <td>
                  {LABELS[status]}
                  {status === "refused" && row.failure_code
                    ? ` (${row.failure_code})`
                    : ""}
                </td>
                <td>{row.delivered_at ? when(row.delivered_at) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
