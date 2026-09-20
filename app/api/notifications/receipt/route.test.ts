// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { hashReceiptToken } from "../../../../lib/notifications/receipt-token";
import { POST } from "./route";

vi.mock("../../../../lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

type Write = {
  fields: Record<string, unknown>;
  matchedColumn: string;
  matchedValue: string;
  onlyIfBlank: string;
};

function givenDatabase({ fail = false } = {}) {
  const writes: Write[] = [];
  const from = vi.fn(() => ({
    update: (fields: Record<string, unknown>) => ({
      eq: (matchedColumn: string, matchedValue: string) => ({
        is: async (onlyIfBlank: string) => {
          if (fail) {
            throw new Error("database unreachable");
          }
          writes.push({ fields, matchedColumn, matchedValue, onlyIfBlank });
          return { error: null };
        },
      }),
    }),
  }));
  vi.mocked(createAdminClient).mockReturnValue(
    { from } as unknown as ReturnType<typeof createAdminClient>,
  );
  return { writes, from };
}

function report(body: unknown, { raw = false } = {}) {
  return new Request("https://homebase.example/api/notifications/receipt", {
    method: "POST",
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

const TOKEN = "a-token-of-a-plausible-length-here";

describe("the receipt address", () => {
  beforeEach(() => {
    givenDatabase();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("records a delivery against the row holding that token", async () => {
    const { writes } = givenDatabase();
    const response = await POST(report({ receipt: TOKEN, event: "delivered" }));
    expect(response.status).toBe(204);
    expect(writes).toHaveLength(1);
    expect(writes[0].onlyIfBlank).toBe("delivered_at");
    expect(typeof writes[0].fields.delivered_at).toBe("string");
  });

  // On iOS the tap can be the first we hear: the phone may show a
  // notification without the worker getting a chance to report it.
  it("takes a tap as proof of delivery too", async () => {
    const { writes } = givenDatabase();
    await POST(report({ receipt: TOKEN, event: "tapped" }));
    const columns = writes.map((write) => write.onlyIfBlank).sort();
    expect(columns).toEqual(["delivered_at", "tapped_at"]);
  });

  // The first report is the honest one. A repeat must not push the
  // recorded time forward, or a re-delivered message would look faster
  // or slower than it was.
  it("only ever fills in a blank, never overwrites a time", async () => {
    const { writes } = givenDatabase();
    await POST(report({ receipt: TOKEN, event: "delivered" }));
    expect(writes[0].onlyIfBlank).toBe("delivered_at");
  });

  it.each([
    ["a body that isn't JSON", "not json at all", true],
    ["no token", { event: "delivered" }, false],
    ["a token that isn't a string", { receipt: 12, event: "delivered" }, false],
    ["a token full of punctuation", { receipt: "../../etc", event: "delivered" }, false],
    ["an empty token", { receipt: "", event: "delivered" }, false],
    ["no event", { receipt: TOKEN }, false],
    ["an event we don't know", { receipt: TOKEN, event: "read" }, false],
  ])("writes nothing when given %s", async (_case, body, raw) => {
    const { writes } = givenDatabase();
    const response = await POST(report(body, { raw: raw as boolean }));
    expect(response.status).toBe(204);
    expect(writes).toHaveLength(0);
  });

  // A different answer for a token that matched would turn this address
  // into a way of testing guesses.
  it("answers exactly the same whether or not the token was any good", async () => {
    givenDatabase();
    const good = await POST(report({ receipt: TOKEN, event: "delivered" }));
    const bad = await POST(report({ receipt: "!!!", event: "delivered" }));
    expect(good.status).toBe(bad.status);
    expect(await good.text()).toBe(await bad.text());
  });

  // A lost receipt costs one row's accuracy. It must never come back to
  // the phone as an error it might retry.
  it("still answers normally when the database is unreachable", async () => {
    givenDatabase({ fail: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(report({ receipt: TOKEN, event: "delivered" }));
    expect(response.status).toBe(204);
  });

  // The log holds hashes, so the token that arrives has to be hashed the
  // same way to find its row. Looking it up by the raw token would find
  // nothing, and every delivery would silently go unrecorded.
  it("looks the row up by the hash of the token, not the token", async () => {
    const { writes } = givenDatabase();
    await POST(report({ receipt: TOKEN, event: "delivered" }));
    expect(writes[0].matchedColumn).toBe("receipt_hash");
    expect(writes[0].matchedValue).toBe(hashReceiptToken(TOKEN));
    expect(writes[0].matchedValue).not.toBe(TOKEN);
  });
});
