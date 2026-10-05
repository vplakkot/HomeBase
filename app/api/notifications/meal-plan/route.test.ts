// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runMealPlanSchedule } from "../../../../lib/meal-plans/schedule";
import { POST } from "./route";

vi.mock("../../../../lib/meal-plans/schedule", () => ({ runMealPlanSchedule: vi.fn() }));

const SECRET = "a-long-shared-secret-value";

function request(authorization?: string) {
  return new NextRequest(new URL("https://homebase.example/api/notifications/meal-plan"), {
    method: "POST",
    headers: authorization ? { authorization } : undefined,
  });
}

describe("the Meal Plan lifecycle's way in (REQ-163)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("runs the schedule, from this server's own address, for the database's clock", async () => {
    vi.stubEnv("NOTIFY_SECRET", SECRET);
    vi.mocked(runMealPlanSchedule).mockResolvedValue({ closed: 1, slid: 0, sent: 2, quiet: false });
    const response = await POST(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ closed: 1, slid: 0, sent: 2, quiet: false });
    expect(runMealPlanSchedule).toHaveBeenCalledWith({ subject: "https://homebase.example" });
  });

  it("refuses anyone without the secret, and does nothing", async () => {
    vi.stubEnv("NOTIFY_SECRET", SECRET);
    expect((await POST(request("Bearer wrong-secret-value-xxxxxx"))).status).toBe(401);
    expect((await POST(request())).status).toBe(401);
    expect(runMealPlanSchedule).not.toHaveBeenCalled();
  });
});
