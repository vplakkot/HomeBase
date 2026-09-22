// Dollar amounts as typed into a form: a positive number with at most two
// decimals, commas and a leading $ allowed. Null for anything else.
export function parseAmount(text: string): number | null {
  const cleaned = text.trim().replace(/^\$/, "").replaceAll(",", "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const amount = Number(cleaned);
  return amount > 0 ? amount : null;
}

export function formatMoney(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
