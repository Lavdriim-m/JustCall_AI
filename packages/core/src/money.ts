/** Money helpers. All amounts are integer cents (Rappen). */

/** "CHF 18.50" */
export function formatChf(cents: number, { withCurrency = true } = {}): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const francs = Math.floor(abs / 100);
  const rappen = abs % 100;
  const francsStr = francs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  const value = `${sign}${francsStr}.${rappen.toString().padStart(2, "0")}`;
  return withCurrency ? `CHF ${value}` : value;
}

/** Spoken German form: "18 Franken 50", "12 Franken". */
export function spokenChf(cents: number): string {
  const abs = Math.abs(Math.round(cents));
  const francs = Math.floor(abs / 100);
  const rappen = abs % 100;
  const prefix = cents < 0 ? "minus " : "";
  if (rappen === 0) return `${prefix}${francs} Franken`;
  if (francs === 0) return `${prefix}${rappen} Rappen`;
  return `${prefix}${francs} Franken ${rappen}`;
}

/** Parses "18.50", "18,50", "18.-", "CHF 18" into cents. Returns null when invalid. */
export function parseChf(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) ? Math.round(input * 100) : null;
  const cleaned = input
    .replace(/chf|fr\.?|sfr\.?/gi, "")
    .replace(/[’' ]/g, "")
    .replace(/[.,]-+$/, "")
    .replace(/–|—/g, "")
    .replace(",", ".")
    .trim();
  if (!cleaned) return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}

/** Applies a basis-point rate with commercial rounding to the cent. */
export function applyBps(amountCents: number, bps: number): number {
  return Math.round((amountCents * bps) / 10_000);
}

/** Rounds to the nearest 5 Rappen (Swiss cash rounding). */
export function roundTo5Rappen(cents: number): number {
  return Math.round(cents / 5) * 5;
}

export function formatPercentFromBps(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(2).replace(/0$/, "")}%`;
}
