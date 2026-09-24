// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendPush } from "../notifications/send";
import { createAdminClient } from "../supabase/admin";
import type { FinanceSnapshot } from "./action-items";
import { householdHour, sendFinanceReminders } from "./reminders";
import { householdForJob, readFinanceSnapshot } from "./snapshot";

vi.mock("../supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("../notifications/send", () => ({ sendPush: vi.fn() }));
vi.mock("./snapshot", () => ({ householdForJob: vi.fn(), readFinanceSnapshot: vi.fn() }));

// Invented people and a month not yet opened: both are due "enter".
const SNAPSHOT: FinanceSnapshot = {
  today: "2026-10-01",
  people: [
    { user_id: "a", name: "", manages_budget: true },
    { user_id: "b", name: "", manages_budget: false },
  ],
  splits: [{ id: "s", effective_from: "2026-04-01", note: "", shares: [{ user_id: "a", percent: 50 }, { user_id: "b", percent: 50 }] }],
  billCount: 1,
  months: [],
  balances: [],
  acks: [],
};

// The secret-key client: what finance_pushes already holds, and which
// claims go in (a claim another run already made comes back empty).
function admin({ sent = [], taken = [] }: { sent?: { user_id: string; topic: string }[]; taken?: string[] }) {
  const claims: { user_id: string; topic: string }[] = [];
  vi.mocked(createAdminClient).mockReturnValue({
    from: () => ({
      select: async () => ({ data: sent, error: null }),
      upsert: (row: { user_id: string; topic: string }) => ({
        select: async () => {
          claims.push(row);
          return { data: taken.includes(row.user_id) ? [] : [row], error: null };
        },
      }),
    }),
  } as unknown as ReturnType<typeof createAdminClient>);
  return claims;
}

// 13:00 UTC is 9 in the morning in New York in October.
const NINE_AM = new Date("2026-10-01T13:00:00Z");

describe("the hourly Finances reminders", () => {
  afterEach(() => vi.clearAllMocks());

  it("reads the household's hour in New York", () => {
    expect(householdHour(NINE_AM)).toBe(9);
    expect(householdHour(new Date("2026-10-02T01:00:00Z"))).toBe(21);
  });

  it("sends nothing outside 9am to 9pm, and reads nothing", async () => {
    const result = await sendFinanceReminders({ subject: "https://homebase.example", now: new Date("2026-10-01T12:00:00Z") });
    expect(result).toEqual({ sent: 0, quiet: true });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("claims each push before sending it, to its one person, with no dollar figure", async () => {
    vi.mocked(householdForJob).mockResolvedValue(SNAPSHOT.people);
    vi.mocked(readFinanceSnapshot).mockResolvedValue(SNAPSHOT);
    vi.mocked(sendPush).mockResolvedValue({ delivered: 1 } as Awaited<ReturnType<typeof sendPush>>);
    const claims = admin({});
    const result = await sendFinanceReminders({ subject: "https://homebase.example", now: NINE_AM });
    expect(claims).toEqual([
      { user_id: "a", topic: "enter:2026-10-01" },
      { user_id: "b", topic: "enter:2026-10-01" },
    ]);
    expect(sendPush).toHaveBeenCalledWith({
      subject: "https://homebase.example",
      trigger: "finances",
      to: ["a"],
      message: { title: "Finances", body: "Time to enter October's numbers.", url: "/finances/monthly-entry?month=2026-10" },
    });
    expect(result).toEqual({ sent: 2, quiet: false });
  });

  it("skips a push another run already claimed, and one already sent", async () => {
    vi.mocked(householdForJob).mockResolvedValue(SNAPSHOT.people);
    vi.mocked(readFinanceSnapshot).mockResolvedValue(SNAPSHOT);
    vi.mocked(sendPush).mockResolvedValue({ delivered: 1 } as Awaited<ReturnType<typeof sendPush>>);
    admin({ sent: [{ user_id: "a", topic: "enter:2026-10-01" }], taken: ["b"] });
    await sendFinanceReminders({ subject: "https://homebase.example", now: NINE_AM });
    // Alex's enter went earlier, so their next one is due now: balances.
    expect(vi.mocked(sendPush).mock.calls.map(([call]) => [call.to, call.message.body])).toEqual([
      [["a"], "A quarter has ended. Time to update balances."],
    ]);
  });
});
