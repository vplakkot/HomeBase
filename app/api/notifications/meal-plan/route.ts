import { NextResponse, type NextRequest } from "next/server";
import { runMealPlanSchedule } from "../../../../lib/meal-plans/schedule";
import { refuseUnlessSchedule } from "../../../../lib/notifications/schedule-auth";

// The Meal Plan lifecycle's way in (REQ-163), called hourly by the database
// with the same shared secret as the other scheduled jobs. It closes plans
// nobody closed, slides plans nobody started, and asks us to start one. It
// answers with counts only.
export async function POST(request: NextRequest) {
  const refused = refuseUnlessSchedule(request);
  if (refused) return refused;
  return NextResponse.json(await runMealPlanSchedule({ subject: request.nextUrl.origin }));
}
