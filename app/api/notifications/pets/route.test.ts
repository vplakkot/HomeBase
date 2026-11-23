// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runPetSchedule } from "../../../../lib/pets/notify";
import { POST } from "./route";

vi.mock("../../../../lib/pets/notify", () => ({ runPetSchedule: vi.fn() }));

const SECRET = "a-long-shared-secret-value";

function request(authorization?: string) {
  return new NextRequest(new URL("https://homebase.example/api/notifications/pets"), {
    method: "POST",
    headers: authorization ? { authorization } : undefined,
  });
}

describe("the Pets notifications' way in (REQ-190, REQ-192)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("runs the schedule, from this server's own address, for the database's clock", async () => {
    vi.stubEnv("NOTIFY_SECRET", SECRET);
    vi.mocked(runPetSchedule).mockResolvedValue({ diets: 1, reminders: 2, quiet: false });
    const response = await POST(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ diets: 1, reminders: 2, quiet: false });
    expect(runPetSchedule).toHaveBeenCalledWith({ subject: "https://homebase.example" });
  });

  it("refuses anyone without the secret, and does nothing", async () => {
    vi.stubEnv("NOTIFY_SECRET", SECRET);
    expect((await POST(request("Bearer wrong-secret-value-xxxxxx"))).status).toBe(401);
    expect((await POST(request())).status).toBe(401);
    expect(runPetSchedule).not.toHaveBeenCalled();
  });
});
