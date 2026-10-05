import { householdToday } from "../finances/budget-year";
import { householdHour } from "../finances/reminders";
import { isSwitchedOff } from "../module-switches";
import { sendPush } from "../notifications/send";
import { createAdminClient } from "../supabase/admin";
import { daysBetween, planEnd, slide } from "./meals";
import { readStoredPlans, saveLayout, syncAheadStart, type MealPlan } from "./plan";

// REQ-163: what the hourly job does for the plan we're on, all by the
// household's clock (ET). It closes a started plan nobody closed, slides a
// new plan nobody started, and asks us to start a new plan on the day it is
// meant to start.

// "Start this week's plan?" goes at 11:00 AM when the first meal is lunch
// and at 6:00 PM when it is dinner. The job runs hourly, so a run that is
// late still sends, within the next few hours; after that it would be stale.
export const LUNCH_PROMPT_HOUR = 11;
export const DINNER_PROMPT_HOUR = 18;
const PROMPT_WINDOW_HOURS = 3;

type Scheduled = Pick<MealPlan, "ahead" | "status" | "starts_on" | "starts_meal" | "recipes" | "start_prompted_on">;

// A started plan nobody closed closes the day after its last filled meal
// (leftovers count). A plan with nothing in it closes the day after its start.
export function shouldAutoClose(plan: Scheduled, today: string): boolean {
  if (plan.ahead || plan.status !== "started") return false;
  const last = planEnd(plan.recipes)?.day ?? plan.starts_on;
  return today > last;
}

// A new plan not started by the end of its start day slides: its start
// becomes today, and its meals go with it.
export function shouldSlide(plan: Scheduled, today: string): boolean {
  return !plan.ahead && plan.status === "new" && plan.starts_on < today;
}

export function startPromptDue(plan: Scheduled, today: string, hour: number): boolean {
  if (plan.ahead || plan.status !== "new" || plan.starts_on !== today || plan.start_prompted_on === today) return false;
  const from = plan.starts_meal === "lunch" ? LUNCH_PROMPT_HOUR : DINNER_PROMPT_HOUR;
  return hour >= from && hour < from + PROMPT_WINDOW_HOURS;
}

export async function runMealPlanSchedule({ subject, now = new Date() }: { subject: string; now?: Date }) {
  const admin = createAdminClient();
  const today = householdToday(now);
  let closed = 0;
  let slid = 0;
  // Closing the plan we're on makes the plan ahead current, and that one may
  // need to slide too, so look again after a close.
  for (let round = 0; round < 3; round++) {
    const { current } = await readStoredPlans(admin);
    if (!current) break;
    if (shouldAutoClose(current, today)) {
      const { error } = await admin.rpc("close_meal_plan_system", { p_plan: current.id, p_only_started: true });
      if (error) throw new Error(`Could not close the plan: ${error.message}`);
      closed += 1;
      continue;
    }
    if (shouldSlide(current, today)) {
      await saveLayout(admin, current.id, today, current.starts_meal, slide(current.recipes, daysBetween(current.starts_on, today), current.daysOff));
      // Next week's plan follows the one we're on.
      await syncAheadStart(admin);
      slid += 1;
    }
    break;
  }

  // While Meal Plans is off the plans still close and slide, so the data is
  // current when it's turned back on, but nobody is asked anything.
  if (await isSwitchedOff(admin, "meal-plans")) return { closed, slid, sent: 0, quiet: true };
  const { current } = await readStoredPlans(admin);
  if (!current || !startPromptDue(current, today, householdHour(now))) return { closed, slid, sent: 0, quiet: false };
  // Claimed before sending, so two runs that overlap can't both send it.
  const { data: claimed, error } = await admin
    .from("meal_plans")
    .update({ start_prompted_on: today })
    .eq("id", current.id)
    .or(`start_prompted_on.is.null,start_prompted_on.neq.${today}`)
    .select("id");
  if (error) throw new Error(`Could not record the start question: ${error.message}`);
  if (!claimed || claimed.length === 0) return { closed, slid, sent: 0, quiet: false };
  const summary = await sendPush({
    subject,
    trigger: "meal-plan",
    to: null,
    // The plan is in the link, so whoever opens it after the other person pressed Start is told so.
    message: { title: "Meal Plan", body: "Start this week's plan?", url: `/meal-plans/week?start=${current.id}` },
  });
  return { closed, slid, sent: summary.delivered, quiet: false };
}
