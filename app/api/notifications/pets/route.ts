import { NextResponse, type NextRequest } from "next/server";
import { refuseUnlessSchedule } from "../../../../lib/notifications/schedule-auth";
import { runPetSchedule } from "../../../../lib/pets/notify";

// The Pets notifications' way in (REQ-190, REQ-192), called every five
// minutes by the database with the same shared secret as the other
// scheduled jobs. It sends diet changes nobody has touched for five minutes
// and the day's due reminders, and answers with counts only.
export async function POST(request: NextRequest) {
  const refused = refuseUnlessSchedule(request);
  if (refused) return refused;
  return NextResponse.json(await runPetSchedule({ subject: request.nextUrl.origin }));
}
