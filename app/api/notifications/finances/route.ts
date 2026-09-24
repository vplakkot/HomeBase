import { NextResponse, type NextRequest } from "next/server";
import { sendFinanceReminders } from "../../../../lib/finances/reminders";
import { refuseUnlessSchedule } from "../../../../lib/notifications/schedule-auth";

// The Finances reminders' way in (REQ-70), called hourly by the database
// with the same shared secret as the test notification. It answers with a
// count only, for the same reason.
export async function POST(request: NextRequest) {
  const refused = refuseUnlessSchedule(request);
  if (refused) return refused;
  return NextResponse.json(await sendFinanceReminders({ subject: request.nextUrl.origin }));
}
