import { describe, expect, it } from "vitest";
import { composeOrderSms } from "../src/sms";
import { renderInvoicePdf } from "../src/invoice-pdf";
import { sanitizeSenderId } from "../src/twilio";

describe("composeOrderSms", () => {
  it("contains order number, items, total, time and payment with TWINT link", () => {
    const sms = composeOrderSms({
      restaurantName: "Pizzeria Bella Vista",
      restaurantAddress: "Langstrasse 120, Zürich",
      orderNumber: 104,
      customerName: "Müller",
      fulfillment: "pickup",
      estimatedReadyAt: new Date("2026-10-07T16:20:00Z"),
      timezone: "Europe/Zurich",
      totalCents: 4150,
      lines: [
        { quantity: 2, name: "Pizza Napoli", options: [{ optionName: "Gross" }] },
        { quantity: 1, name: "Coca-Cola 0.5l", options: [] },
      ],
      paymentMethod: "twint",
      paymentMethods: ["cash", "twint"],
      twintPaymentUrl: "https://pay.example/twint/abc",
    });
    expect(sms).toContain("Bestellung Nr. 104 bestätigt");
    expect(sms).toContain("2x Pizza Napoli (Gross)");
    expect(sms).toContain("Total CHF 41.50");
    expect(sms).toContain("Abholung ca. 18:20 Uhr");
    expect(sms).toContain("TWINT: https://pay.example/twint/abc");
    expect(sms).not.toMatch(/[–—“”]/);
  });
});

describe("sanitizeSenderId", () => {
  it("creates valid alphanumeric sender IDs", () => {
    expect(sanitizeSenderId("Pizzeria Bella Vista")).toBe("Pizzeria Be");
    expect(sanitizeSenderId("Café Zürich!")).toBe("Cafe Zurich");
    expect(sanitizeSenderId("+41791234567")).toBe("+41791234567");
    expect(sanitizeSenderId("1234")).toBe("JustCall");
  });
});

describe("renderInvoicePdf", () => {
  it("renders a PDF with a QR-bill", async () => {
    const pdf = await renderInvoicePdf({
      restaurantName: "Pizzeria Bella Vista",
      settings: {
        id: 1,
        companyName: "JustCall GmbH",
        street: "Bahnhofstrasse 10",
        postalCode: "8001",
        city: "Zürich",
        country: "CH",
        email: "billing@justcall.example",
        phone: null,
        website: null,
        vatNumber: "CHE-123.456.789 MWST",
        vatRateBps: 810,
        iban: "CH93 0076 2011 6238 5295 7",
        invoicePrefix: "JC",
        paymentTermsDays: 30,
        invoiceFooter: null,
        defaultCommissionBps: 500,
        defaultMonthlyFeeCents: 0,
        updatedAt: new Date(),
      },
      invoice: {
        id: "inv",
        restaurantId: "r",
        number: "JC-2026-0001",
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
        status: "draft",
        issueDate: "2026-10-01",
        dueDate: "2026-10-31",
        currency: "CHF",
        orderCount: 312,
        orderVolumeCents: 1234550,
        subtotalCents: 72868,
        vatRateBps: 810,
        vatCents: 5902,
        totalCents: 78770,
        billTo: {
          name: "Bella Vista Gastro GmbH",
          street: "Langstrasse 120",
          postalCode: "8004",
          city: "Zürich",
          country: "CH",
          email: "x@y.ch",
        },
        paymentReference: "RF18539007547034",
        notes: null,
        sentAt: null,
        paidAt: null,
        voidedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      lines: [
        {
          id: "l1",
          invoiceId: "inv",
          description:
            "Kommission 5% auf Bestellvolumen CHF 12'345.50 (312 Bestellungen, September 2026)",
          quantity: 1,
          unitPriceCents: 61728,
          amountCents: 61728,
          sortOrder: 0,
        },
        {
          id: "l2",
          invoiceId: "inv",
          description: "Monatliche Grundgebühr JustCall (September 2026)",
          quantity: 1,
          unitPriceCents: 4900,
          amountCents: 4900,
          sortOrder: 1,
        },
      ],
    });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(5000);
  });
});
