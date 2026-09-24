// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendFinanceReminders } from "../../../../lib/finances/reminders";
import { POST } from "./route";

vi.mock("../../../../lib/finances/reminders", () => ({ sendFinanceReminders: vi.fn() }));

const SECRET = "a-long-shared-secret-value";

function request(authorization?: string) {
  return new NextRequest(new URL("https://homebase.example/api/notifications/finances"), {
    method: "POST",
    headers: authorization ? { authorization } : undefined,
  });
}

describe("the Finances reminders' way in", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("runs the reminders, from this server's own address, for the schedule", async () => {
    vi.stubEnv("NOTIFY_SECRET", SECRET);
    vi.mocked(sendFinanceReminders).mockResolvedValue({ sent: 2, quiet: false });
    const response = await POST(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: 2, quiet: false });
    expect(sendFinanceReminders).toHaveBeenCalledWith({ subject: "https://homebase.example" });
  });

  it("refuses anyone without the secret, and sends nothing", async () => {
    vi.stubEnv("NOTIFY_SECRET", SECRET);
    expect((await POST(request("Bearer wrong-secret-value-xxxxxx"))).status).toBe(401);
    expect((await POST(request())).status).toBe(401);
    expect(sendFinanceReminders).not.toHaveBeenCalled();
  });
});
