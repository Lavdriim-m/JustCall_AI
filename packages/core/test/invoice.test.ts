import { describe, expect, it } from "vitest";
import {
  computeInvoice,
  createQrReference,
  createScorReference,
  isQrIban,
  isValidIban,
  isValidScorReference,
  monthPeriod,
  previousMonth,
} from "../src/invoice";

describe("computeInvoice", () => {
  it("computes commission, fees and VAT", () => {
    const inv = computeInvoice({
      terms: { commissionBps: 500, monthlyFeeCents: 4900, perOrderFeeCents: 20 },
      orderCount: 312,
      orderVolumeCents: 1_234_550,
      vatRateBps: 810,
      periodLabel: "September 2026",
    });
    expect(inv.lines.map((l) => l.amountCents)).toEqual([61728, 6240, 4900]);
    expect(inv.subtotalCents).toBe(72868);
    expect(inv.vatCents).toBe(5902);
    expect(inv.totalCents).toBe(78770);
    expect(inv.lines[0]!.description).toContain("5%");
  });
  it("omits zero lines", () => {
    const inv = computeInvoice({
      terms: { commissionBps: 300, monthlyFeeCents: 0, perOrderFeeCents: 0 },
      orderCount: 0,
      orderVolumeCents: 0,
      vatRateBps: 0,
      periodLabel: "Oktober 2026",
    });
    expect(inv.lines).toHaveLength(1);
    expect(inv.totalCents).toBe(0);
  });
});

describe("periods", () => {
  it("computes month periods", () => {
    expect(monthPeriod("2026-02")).toEqual({
      start: "2026-02-01",
      end: "2026-02-28",
      label: "Februar 2026",
    });
    expect(previousMonth("2026-01-01")).toBe("2025-12");
  });
});

describe("payment references", () => {
  it("creates valid SCOR references", () => {
    const ref = createScorReference("JC20260001");
    expect(ref.startsWith("RF")).toBe(true);
    expect(isValidScorReference(ref)).toBe(true);
    expect(isValidScorReference("RF18539007547034")).toBe(true);
  });
  it("creates QR references with mod10 check digit", () => {
    expect(createQrReference("21000000000313947143000901")).toBe("210000000003139471430009017");
  });
  it("validates IBANs", () => {
    expect(isValidIban("CH93 0076 2011 6238 5295 7")).toBe(true);
    expect(isValidIban("CH93 0076 2011 6238 5295 8")).toBe(false);
    expect(isQrIban("CH44 3199 9123 0008 8901 2")).toBe(true);
    expect(isQrIban("CH93 0076 2011 6238 5295 7")).toBe(false);
  });
});
