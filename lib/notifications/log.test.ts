// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listRecentLog,
  MISSING_AFTER_MS,
  statusOf,
  summarise,
  SHOW_DAYS,
  type LogRow,
} from "./log";

const NOW = Date.parse("2026-09-20T12:00:00Z");

function row(over: Partial<LogRow> = {}): LogRow {
  return {
    id: "log-1",
    sent_at: new Date(NOW - 60 * 1000).toISOString(),
    trigger: "hourly",
    user_id: "u1",
    device: "a1b2c3d4e5f6",
    delivered_at: null,
    tapped_at: null,
    accepted: true,
    failure_code: null,
    ...over,
  };
}

describe("statusOf", () => {
  it("is waiting while the five minutes are still running", () => {
    expect(statusOf(row(), NOW)).toBe("waiting");
  });

  // The boundary itself, because "after 5 minutes" is the requirement's
  // own wording and an off-by-one here would mislabel every send.
  it("turns missing exactly when the five minutes are up", () => {
    const sent = new Date(NOW - MISSING_AFTER_MS).toISOString();
    expect(statusOf(row({ sent_at: sent }), NOW)).toBe("missing");
    const justBefore = new Date(NOW - MISSING_AFTER_MS + 1).toISOString();
    expect(statusOf(row({ sent_at: justBefore }), NOW)).toBe("waiting");
  });

  it("is delivered once the device has reported it", () => {
    const delivered = new Date(NOW - 30 * 1000).toISOString();
    expect(statusOf(row({ delivered_at: delivered }), NOW)).toBe("delivered");
  });

  it("is tapped once it was opened, which outranks delivered", () => {
    const at = new Date(NOW - 30 * 1000).toISOString();
    expect(statusOf(row({ delivered_at: at, tapped_at: at }), NOW)).toBe("tapped");
  });

  // A send the push service refused never had a chance to arrive.
  // Calling it missing would blame the phone for the server's problem.
  it("is refused, not missing, when the push service turned it down", () => {
    const old = new Date(NOW - 2 * MISSING_AFTER_MS).toISOString();
    expect(statusOf(row({ sent_at: old, accepted: false }), NOW)).toBe("refused");
  });

  // Even a refused send counts as delivered if the device somehow says so,
  // because the device is the better witness.
  it("believes the device over the send's own outcome", () => {
    const at = new Date(NOW - 30 * 1000).toISOString();
    expect(statusOf(row({ accepted: false, delivered_at: at }), NOW)).toBe("delivered");
  });
});

describe("summarise", () => {
  it("counts each kind, and reports nothing when there is nothing to report", () => {
    expect(summarise([], NOW)).toMatchObject({ sent: 0, reliability: null });
  });

  it("scores reliability only against sends we know the answer for", () => {
    const old = new Date(NOW - 2 * MISSING_AFTER_MS).toISOString();
    const at = new Date(NOW - 30 * 1000).toISOString();
    const totals = summarise(
      [
        row({ id: "a", sent_at: old, delivered_at: at }),
        row({ id: "b", sent_at: old, delivered_at: at }),
        row({ id: "c", sent_at: old }),
        // Still in flight: counting this as a failure would make every
        // fresh send drag the score down for five minutes.
        row({ id: "d" }),
      ],
      NOW,
    );
    expect(totals).toMatchObject({
      sent: 4,
      arrived: 2,
      missing: 1,
      waiting: 1,
      reliability: 67,
    });
  });
});

describe("listRecentLog", () => {
  it("asks for the last seven days, newest first", async () => {
    const asked: Record<string, unknown> = {};
    const order = vi.fn(async () => ({ data: [row()], error: null }));
    const supabase = {
      from: vi.fn((table: string) => {
        asked.table = table;
        return {
          select: (columns: string) => {
            asked.columns = columns;
            return {
              gte: (column: string, value: string) => {
                asked.gteColumn = column;
                asked.since = value;
                return { order };
              },
            };
          },
        };
      }),
    } as unknown as SupabaseClient;

    const rows = await listRecentLog(supabase);
    expect(asked.table).toBe("notification_log");
    expect(asked.gteColumn).toBe("sent_at");
    expect(order).toHaveBeenCalledWith("sent_at", { ascending: false });
    expect(rows).toHaveLength(1);

    const days = (Date.now() - Date.parse(String(asked.since))) / 86_400_000;
    expect(days).toBeCloseTo(SHOW_DAYS, 1);
  });

  // The address a device is reached at is deliberately not in this table,
  // so it can't be asked for either.
  it("never asks for anything that could reach a device", async () => {
    const asked: Record<string, unknown> = {};
    const supabase = {
      from: vi.fn(() => ({
        select: (columns: string) => {
          asked.columns = columns;
          return {
            gte: () => ({ order: async () => ({ data: [], error: null }) }),
          };
        },
      })),
    } as unknown as SupabaseClient;
    await listRecentLog(supabase);
    expect(String(asked.columns)).not.toContain("endpoint");
    expect(String(asked.columns)).not.toContain("p256dh");
    expect(String(asked.columns)).not.toContain("auth");
  });

  it("says what went wrong rather than showing an empty log", async () => {
    const supabase = {
      from: vi.fn(() => ({
        select: () => ({
          gte: () => ({
            order: async () => ({ data: null, error: { message: "denied" } }),
          }),
        }),
      })),
    } as unknown as SupabaseClient;
    await expect(listRecentLog(supabase)).rejects.toThrow("denied");
  });
});
