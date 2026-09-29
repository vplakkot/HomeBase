// The three tables the module switches read (REQ-141 to REQ-143), for
// tests whose Supabase stand-in answers table by table: which switches
// are off, which modules this person hid, and whether the household's
// modules were chosen. Any other table gets null, for the test to answer.
export type SwitchRows = { off?: string[]; hidden?: string[]; chosen?: boolean };

export function switchTable(table: string, { off = [], hidden = [], chosen = true }: SwitchRows = {}) {
  const rows =
    table === "modules_off"
      ? off.map((module) => ({ module }))
      : table === "modules_hidden"
        ? hidden.map((module) => ({ module }))
        : table === "households"
          ? [{ modules_chosen: chosen }]
          : null;
  if (!rows) return null;
  const result = { data: rows, error: null };
  const query: Record<string, unknown> = {
    then: (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
  };
  query.select = () => query;
  query.eq = () => query;
  return query;
}
