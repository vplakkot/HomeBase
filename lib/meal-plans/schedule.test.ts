// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isSwitchedOff } from "../module-switches";
import { sendPush } from "../notifications/send";
import { createAdminClient } from "../supabase/admin";
import { readStoredPlans, saveLayout, syncAheadStart, type MealPlan } from "./plan";
import { runMealPlanSchedule, shouldAutoClose, shouldSlide, startPromptDue } from "./schedule";

vi.mock("../supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("../module-switches", () => ({ isSwitchedOff: vi.fn(async () => false) }));
vi.mock("../notifications/send", () => ({ sendPush: vi.fn(async () => ({ delivered: 2 })) }));
vi.mock("./plan", async (original) => ({
  ...(await original<typeof import("./plan")>()),
  readStoredPlans: vi.fn(),
  saveLayout: vi.fn(async () => undefined),
  syncAheadStart: vi.fn(async () => undefined),
}));

// Household time is New York. 2026-10-04 is a Sunday.
const plan = (over: Partial<MealPlan> = {}): MealPlan => ({
  id: "p1",
  starts_on: "2026-10-04",
  starts_meal: "dinner",
  ahead: false,
  status: "started",
  start_prompted_on: null,
  began_by: null,
  daysOff: new Set(),
  recipes: [{ id: "e1", recipe_id: "r1", eating_out: false, meals: 2, meal_on: "2026-10-04", meal: "dinner", cooked: false, carry_over: false, didnt_cook: false, added_at: "" }],
  ...over,
});

describe("what the schedule decides (REQ-163)", () => {
  it("closes a started plan the day after its last filled meal, leftovers included, and not before", () => {
    // Sun dinner + Mon lunch (leftovers): the last filled meal is on Monday.
    expect(shouldAutoClose(plan(), "2026-10-05")).toBe(false);
    expect(shouldAutoClose(plan(), "2026-10-06")).toBe(true);
  });

  it("closes an empty started plan the day after its start, and never closes a new plan or the plan ahead", () => {
    expect(shouldAutoClose(plan({ recipes: [] }), "2026-10-04")).toBe(false);
    expect(shouldAutoClose(plan({ recipes: [] }), "2026-10-05")).toBe(true);
    expect(shouldAutoClose(plan({ status: "new" }), "2026-12-01")).toBe(false);
    expect(shouldAutoClose(plan({ ahead: true, status: "new" }), "2026-12-01")).toBe(false);
  });

  it("slides a new plan once its start day is over, and nothing else", () => {
    expect(shouldSlide(plan({ status: "new" }), "2026-10-04")).toBe(false);
    expect(shouldSlide(plan({ status: "new" }), "2026-10-05")).toBe(true);
    expect(shouldSlide(plan({ status: "started" }), "2026-10-05")).toBe(false);
    expect(shouldSlide(plan({ status: "new", ahead: true }), "2026-10-05")).toBe(false);
  });

  it("asks at 11:00 AM for a lunch start and 6:00 PM for a dinner start, on the start day, once", () => {
    const lunch = plan({ status: "new", starts_meal: "lunch" });
    const dinner = plan({ status: "new" });
    expect(startPromptDue(lunch, "2026-10-04", 10)).toBe(false);
    expect(startPromptDue(lunch, "2026-10-04", 11)).toBe(true);
    expect(startPromptDue(dinner, "2026-10-04", 11)).toBe(false);
    expect(startPromptDue(dinner, "2026-10-04", 18)).toBe(true);
    // A late run still sends, within a few hours; much later it would be stale.
    expect(startPromptDue(dinner, "2026-10-04", 20)).toBe(true);
    expect(startPromptDue(dinner, "2026-10-04", 22)).toBe(false);
    expect(startPromptDue({ ...dinner, start_prompted_on: "2026-10-04" }, "2026-10-04", 18)).toBe(false);
    expect(startPromptDue(dinner, "2026-10-05", 18)).toBe(false);
    expect(startPromptDue(plan({ status: "started" }), "2026-10-04", 18)).toBe(false);
  });
});

describe("running the schedule (REQ-163)", () => {
  const rpc = vi.fn(async () => ({ error: null }));
  const claim = vi.fn(async () => ({ data: [{ id: "p1" }], error: null }));
  const update = vi.fn(() => ({ eq: () => ({ or: () => ({ select: claim }) }) }));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createAdminClient).mockReturnValue({ rpc, from: () => ({ update }) } as never);
    vi.mocked(isSwitchedOff).mockResolvedValue(false);
  });

  // 22:00 UTC on 2026-10-04 is 6:00 PM in New York (daylight time).
  const SIX_PM = new Date("2026-10-04T22:00:00Z");

  it("asks every member to start a new plan at 6:00 PM when its first meal is dinner, and records it", async () => {
    vi.mocked(readStoredPlans).mockResolvedValue({ current: plan({ status: "new" }), ahead: null });
    const result = await runMealPlanSchedule({ subject: "https://homebase.example", now: SIX_PM });
    expect(result).toEqual({ closed: 0, slid: 0, sent: 2, quiet: false });
    expect(update).toHaveBeenCalledWith({ start_prompted_on: "2026-10-04" });
    expect(sendPush).toHaveBeenCalledWith({
      subject: "https://homebase.example",
      trigger: "meal-plan",
      to: null,
      message: { title: "Meal Plan", body: "Start this week's plan?", url: "/meal-plans/week?start=p1" },
    });
  });

  it("sends nothing before the hour, when another run already claimed it, or once started", async () => {
    vi.mocked(readStoredPlans).mockResolvedValue({ current: plan({ status: "new" }), ahead: null });
    await runMealPlanSchedule({ subject: "s", now: new Date("2026-10-04T20:00:00Z") });
    expect(sendPush).not.toHaveBeenCalled();
    claim.mockResolvedValueOnce({ data: [], error: null });
    await runMealPlanSchedule({ subject: "s", now: SIX_PM });
    expect(sendPush).not.toHaveBeenCalled();
    vi.mocked(readStoredPlans).mockResolvedValue({ current: plan({ status: "started" }), ahead: null });
    await runMealPlanSchedule({ subject: "s", now: SIX_PM });
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("closes a plan nobody closed, then slides the plan ahead that became current, and asks about neither before they're due", async () => {
    // Monday 2026-10-05 noon in New York: the Sunday dish's leftovers were Monday lunch, so the plan closed overnight... it closes now.
    const finished = plan({ starts_on: "2026-10-04", recipes: plan().recipes });
    const promoted = plan({ id: "p2", status: "new", starts_on: "2026-10-04", recipes: [] });
    vi.mocked(readStoredPlans)
      .mockResolvedValueOnce({ current: finished, ahead: promoted })
      .mockResolvedValueOnce({ current: promoted, ahead: null })
      .mockResolvedValue({ current: promoted, ahead: null });
    const result = await runMealPlanSchedule({ subject: "s", now: new Date("2026-10-06T16:00:00Z") });
    expect(rpc).toHaveBeenCalledWith("close_meal_plan_system", { p_plan: "p1", p_only_started: true });
    expect(saveLayout).toHaveBeenCalledWith(expect.anything(), "p2", "2026-10-06", "dinner", []);
    expect(syncAheadStart).toHaveBeenCalled();
    expect(result).toMatchObject({ closed: 1, slid: 1, sent: 0 });
  });

  it("slides a new plan to today with its dishes, and next week's plan follows", async () => {
    // A new plan from Sunday not started: on Tuesday its Sunday-dinner dish moves to Tuesday dinner.
    vi.mocked(readStoredPlans).mockResolvedValue({ current: plan({ status: "new" }), ahead: null });
    await runMealPlanSchedule({ subject: "s", now: new Date("2026-10-06T16:00:00Z") });
    const saved = vi.mocked(saveLayout).mock.calls[0];
    expect(saved[1]).toBe("p1");
    expect(saved[2]).toBe("2026-10-06");
    expect(saved[4]).toEqual([expect.objectContaining({ id: "e1", meal_on: "2026-10-06", meal: "dinner", meals: 2 })]);
    expect(syncAheadStart).toHaveBeenCalledTimes(1);
  });

  it("keeps closing and sliding while Meal Plans is switched off, but asks nobody", async () => {
    vi.mocked(isSwitchedOff).mockResolvedValue(true);
    vi.mocked(readStoredPlans).mockResolvedValue({ current: plan({ status: "new" }), ahead: null });
    const result = await runMealPlanSchedule({ subject: "s", now: SIX_PM });
    expect(result).toEqual({ closed: 0, slid: 0, sent: 0, quiet: true });
    expect(sendPush).not.toHaveBeenCalled();
  });
});
