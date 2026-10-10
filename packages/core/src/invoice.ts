/**
 * Monthly billing: commission on order volume, fixed fees, VAT and Swiss payment references.
 */
import { applyBps, formatChf, formatPercentFromBps } from "./money";

export type BillingTerms = {
  commissionBps: number;
  monthlyFeeCents: number;
  perOrderFeeCents: number;
};

export type InvoiceInput = {
  terms: BillingTerms;
  orderCount: number;
  orderVolumeCents: number;
  vatRateBps: number;
  periodLabel: string;
};

export type ComputedInvoiceLine = {
  description: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
};

export type ComputedInvoice = {
  lines: ComputedInvoiceLine[];
  subtotalCents: number;
  vatRateBps: number;
  vatCents: number;
  totalCents: number;
};

export function computeInvoice(input: InvoiceInput): ComputedInvoice {
  const { terms, orderCount, orderVolumeCents, vatRateBps, periodLabel } = input;
  const lines: ComputedInvoiceLine[] = [];
  if (terms.commissionBps > 0) {
    const amount = applyBps(orderVolumeCents, terms.commissionBps);
    lines.push({
      description: `Kommission ${formatPercentFromBps(terms.commissionBps)} auf Bestellvolumen ${formatChf(orderVolumeCents)} (${orderCount} Bestellungen, ${periodLabel})`,
      quantity: 1,
      unitPriceCents: amount,
      amountCents: amount,
    });
  }
  if (terms.perOrderFeeCents > 0 && orderCount > 0) {
    lines.push({
      description: `Gebühr pro Bestellung (${periodLabel})`,
      quantity: orderCount,
      unitPriceCents: terms.perOrderFeeCents,
      amountCents: terms.perOrderFeeCents * orderCount,
    });
  }
  if (terms.monthlyFeeCents > 0) {
    lines.push({
      description: `Monatliche Grundgebühr JustCall (${periodLabel})`,
      quantity: 1,
      unitPriceCents: terms.monthlyFeeCents,
      amountCents: terms.monthlyFeeCents,
    });
  }
  const subtotalCents = lines.reduce((acc, l) => acc + l.amountCents, 0);
  const vatCents = applyBps(subtotalCents, vatRateBps);
  return { lines, subtotalCents, vatRateBps, vatCents, totalCents: subtotalCents + vatCents };
}

/** First and last day (YYYY-MM-DD) of the month containing `date` (YYYY-MM or YYYY-MM-DD). */
export function monthPeriod(yearMonth: string): { start: string; end: string; label: string } {
  const [y, m] = yearMonth.split("-").map(Number) as [number, number];
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end, label: `${MONTHS_DE[m - 1]} ${y}` };
}

/** The month before the given local date, as YYYY-MM. */
export function previousMonth(date: string): string {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const MONTHS_DE = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

export function formatInvoiceNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(4, "0")}`;
}

/* ----------------------------- Payment references ----------------------------- */

function mod97(numeric: string): number {
  let remainder = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    remainder = Number(`${remainder}${numeric.slice(i, i + 7)}`) % 97;
  }
  return remainder;
}

function lettersToDigits(s: string): string {
  return s
    .toUpperCase()
    .split("")
    .map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c))
    .join("");
}

/** ISO 11649 creditor reference ("RF18 5390 0754 7034"), usable with a regular IBAN on a QR-bill. */
export function createScorReference(input: string): string {
  const ref = input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 21);
  if (!ref) throw new Error("Reference must contain alphanumeric characters");
  const check = 98 - mod97(lettersToDigits(`${ref}RF00`));
  return `RF${String(check).padStart(2, "0")}${ref}`;
}

export function isValidScorReference(reference: string): boolean {
  const r = reference.replace(/\s/g, "").toUpperCase();
  if (!/^RF\d{2}[A-Z0-9]{1,21}$/.test(r)) return false;
  return mod97(lettersToDigits(`${r.slice(4)}${r.slice(0, 4)}`)) === 1;
}

/** QR reference (27 digits, modulo 10 recursive) – required when the IBAN is a QR-IBAN. */
export function createQrReference(numeric: string): string {
  const digits = numeric.replace(/\D/g, "").slice(-26).padStart(26, "0");
  const table = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5];
  let carry = 0;
  for (const ch of digits) carry = table[(carry + Number(ch)) % 10]!;
  return `${digits}${(10 - carry) % 10}`;
}

/** QR-IBANs have an institution id (IID) between 30000 and 31999. */
export function isQrIban(iban: string): boolean {
  const clean = iban.replace(/\s/g, "").toUpperCase();
  if (!/^(CH|LI)\d{7}/.test(clean)) return false;
  const iid = Number(clean.slice(4, 9));
  return iid >= 30000 && iid <= 31999;
}

export function isValidIban(iban: string): boolean {
  const clean = iban.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(clean)) return false;
  return mod97(lettersToDigits(`${clean.slice(4)}${clean.slice(0, 4)}`)) === 1;
}

export function formatIban(iban: string): string {
  return iban
    .replace(/\s/g, "")
    .toUpperCase()
    .replace(/(.{4})/g, "$1 ")
    .trim();
}
