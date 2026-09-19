// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendTestNotification } from "../../../../lib/notifications/send";
import { POST } from "./route";

vi.mock("../../../../lib/notifications/send", () => ({
  sendTestNotification: vi.fn(),
}));

const SECRET = "a-long-shared-secret-value";

function request(authorization?: string) {
  return new NextRequest(new URL("https://homebase.example/api/notifications/test"), {
    method: "POST",
    headers: authorization ? { authorization } : undefined,
  });
}

describe("the hourly schedule's way in", () => {
  beforeEach(() => {
    vi.mocked(sendTestNotification).mockResolvedValue({
      trigger: "hourly",
      people: 1,
      devices: 2,
      delivered: 2,
      failed: 0,
      removed: 0,
      outcomes: [],
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("sends when the caller knows the shared secret", async () => {
    vi.stubEnv("NOTIFY_SECRET", SECRET);
    const response = await POST(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ delivered: 2 });
    expect(sendTestNotification).toHaveBeenCalledWith({
      subject: "https://homebase.example",
      trigger: "hourly",
    });
  });

  it.each([
    ["nothing at all", undefined],
    ["the wrong secret", "Bearer not-the-secret"],
    ["a secret of the right length but wrong", "Bearer a-long-shared-secret-valuX"],
    ["the secret without Bearer", SECRET],
    ["an empty secret", "Bearer "],
  ])("refuses a caller offering %s", async (_case, authorization) => {
    vi.stubEnv("NOTIFY_SECRET", SECRET);
    const response = await POST(request(authorization));
    expect(response.status).toBe(401);
    expect(sendTestNotification).not.toHaveBeenCalled();
  });

  it("says so, and sends nothing, when no secret is set on the server", async () => {
    vi.stubEnv("NOTIFY_SECRET", "");
    const response = await POST(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(503);
    expect(sendTestNotification).not.toHaveBeenCalled();
  });
});
