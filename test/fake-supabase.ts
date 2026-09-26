import { vi } from "vitest";

// A stand-in for the Supabase client that pages read through: who is
// signed in, which permissions they hold, the household's people, and the
// rows each table holds. Every query on a table answers with all its rows
// (maybeSingle with the first), so a test sets up exactly what the page
// should find. Writes are recorded on the returned spies.
export type FakeData = {
  signedIn?: boolean;
  permissions?: string[];
  people?: { user_id: string; name: string; manages_budget: boolean }[];
  tables?: Record<string, unknown[]>;
};

export function fakeSupabase({ signedIn = true, permissions = [], people = [], tables = {} }: FakeData = {}) {
  const rpc = vi.fn(async (fn: string, args?: { permission?: string }) => {
    if (fn === "has_permission") return { data: permissions.includes(args?.permission ?? ""), error: null };
    if (fn === "household_people") return { data: people, error: null };
    return { data: null, error: null };
  });
  const from = vi.fn((table: string) => {
    const rows = tables[table] ?? [];
    // count answers a select asked for { count: "exact" }.
    const result = { data: rows, count: rows.length, error: null };
    const query: Record<string, unknown> = {
      then: (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      single: async () => ({ data: rows[0] ?? null, error: null }),
    };
    for (const method of ["select", "eq", "neq", "in", "is", "gte", "order", "insert", "update", "upsert", "delete"]) {
      query[method] = vi.fn(() => query);
    }
    return query;
  });
  // Storage (Drinks' label photos): uploads and removals are recorded,
  // and a signed link is the path under an invented address.
  const bucket = {
    upload: vi.fn(async (path: string) => ({ data: { path }, error: null })),
    remove: vi.fn(async () => ({ data: [], error: null })),
    createSignedUrls: vi.fn(async (paths: string[]) => ({
      data: paths.map((path) => ({ path, signedUrl: `https://signed.example/${path}`, error: null })),
      error: null,
    })),
  };
  const storage = { from: vi.fn(() => bucket), bucket };
  return {
    storage,
    auth: {
      getClaims: vi.fn().mockResolvedValue({
        data: signedIn ? { claims: { sub: "user-1" } } : null,
        error: null,
      }),
    },
    rpc,
    from,
  };
}
