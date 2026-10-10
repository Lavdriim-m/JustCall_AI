import { formatChf, formatIban, isQrIban, createQrReference } from "@justcall/core";
import type { Invoice, InvoiceLine, PlatformSettings } from "@justcall/db";
import PDFDocument from "pdfkit";
import { SwissQRBill } from "swissqrbill/pdf";
import type { Data as QrData } from "swissqrbill/types";

const MM = 2.8346456693;

function splitStreet(street: string | null | undefined): {
  address: string;
  buildingNumber?: string;
} {
  const s = (street ?? "").trim();
  const m = /^(.*?)[\s,]+(\d+[a-zA-Z]?(?:[-/]\d+[a-zA-Z]?)?)$/.exec(s);
  return m ? { address: m[1]!, buildingNumber: m[2]! } : { address: s };
}

function formatDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}.${m}.${y}`;
}

export type InvoicePdfInput = {
  invoice: Invoice;
  lines: InvoiceLine[];
  settings: PlatformSettings;
  restaurantName: string;
};

/** Renders an A4 invoice with an attached Swiss QR-bill payment part. */
export function renderInvoicePdf({
  invoice,
  lines,
  settings,
  restaurantName,
}: InvoicePdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 50,
      info: { Title: `Rechnung ${invoice.number}`, Author: settings.companyName },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = 50;
    const right = doc.page.width - 50;
    const width = right - left;

    // Sender
    doc.font("Helvetica-Bold").fontSize(16).text(settings.companyName, left, 50);
    doc.font("Helvetica").fontSize(9).fillColor("#444");
    const senderLines = [
      settings.street,
      [settings.postalCode, settings.city].filter(Boolean).join(" "),
      settings.email,
      settings.phone,
      settings.website,
      settings.vatNumber ? `MWST-Nr. ${settings.vatNumber}` : null,
    ].filter(Boolean) as string[];
    doc.text(senderLines.join("\n"), left, 72);

    // Recipient (right, fits a C5 window envelope)
    const bill = invoice.billTo;
    doc.fillColor("#000").fontSize(10).font("Helvetica");
    doc.text(
      [bill.name, bill.street, [bill.postalCode, bill.city].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join("\n"),
      330,
      150,
      {
        width: 210,
      },
    );

    // Title & meta
    doc.font("Helvetica-Bold").fontSize(18).text(`Rechnung ${invoice.number}`, left, 250);
    doc.font("Helvetica").fontSize(10);
    const meta: [string, string][] = [
      ["Rechnungsdatum", formatDate(invoice.issueDate)],
      ["Zahlbar bis", formatDate(invoice.dueDate)],
      [
        "Leistungszeitraum",
        `${formatDate(invoice.periodStart)} – ${formatDate(invoice.periodEnd)}`,
      ],
      ["Restaurant", restaurantName],
      ["Bestellungen", `${invoice.orderCount} (Volumen ${formatChf(invoice.orderVolumeCents)})`],
    ];
    let y = 280;
    for (const [k, v] of meta) {
      doc.fillColor("#555").text(k, left, y, { width: 130 });
      doc.fillColor("#000").text(v, left + 130, y, { width: width - 130 });
      y += 15;
    }

    // Line items
    y += 15;
    const col = { desc: left, qty: left + 300, unit: left + 350, amount: right - 90 };
    doc.font("Helvetica-Bold").fontSize(9);
    doc.text("Beschreibung", col.desc, y);
    doc.text("Menge", col.qty, y, { width: 40, align: "right" });
    doc.text("Preis", col.unit, y, { width: 80, align: "right" });
    doc.text("Betrag", col.amount, y, { width: 90, align: "right" });
    y += 14;
    doc.moveTo(left, y).lineTo(right, y).strokeColor("#999").lineWidth(0.5).stroke();
    y += 6;
    doc.font("Helvetica").fontSize(9);
    for (const line of lines) {
      const h = doc.heightOfString(line.description, { width: 290 });
      doc.text(line.description, col.desc, y, { width: 290 });
      doc.text(String(line.quantity), col.qty, y, { width: 40, align: "right" });
      doc.text(formatChf(line.unitPriceCents, { withCurrency: false }), col.unit, y, {
        width: 80,
        align: "right",
      });
      doc.text(formatChf(line.amountCents, { withCurrency: false }), col.amount, y, {
        width: 90,
        align: "right",
      });
      y += Math.max(h, 12) + 6;
    }
    doc.moveTo(left, y).lineTo(right, y).strokeColor("#999").stroke();
    y += 8;

    const totalRow = (label: string, value: string, bold = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9);
      doc.text(label, col.unit - 120, y, { width: 200, align: "right" });
      doc.text(value, col.amount, y, { width: 90, align: "right" });
      y += bold ? 18 : 14;
    };
    totalRow("Zwischensumme", formatChf(invoice.subtotalCents, { withCurrency: false }));
    if (invoice.vatRateBps > 0) {
      totalRow(
        `MWST ${(invoice.vatRateBps / 100).toFixed(1)}%`,
        formatChf(invoice.vatCents, { withCurrency: false }),
      );
    }
    totalRow("Total CHF", formatChf(invoice.totalCents, { withCurrency: false }), true);

    y += 10;
    doc.font("Helvetica").fontSize(9).fillColor("#333");
    const note = [
      `Zahlbar innert ${settings.paymentTermsDays} Tagen mit dem untenstehenden QR-Einzahlungsschein.`,
      invoice.vatRateBps === 0 ? "Nicht mehrwertsteuerpflichtig." : null,
      invoice.notes,
      settings.invoiceFooter,
    ]
      .filter(Boolean)
      .join("\n");
    doc.text(note, left, y, { width });

    // QR-bill payment part
    if (settings.iban && settings.street && settings.postalCode && settings.city) {
      const creditorStreet = splitStreet(settings.street);
      const debtorStreet = splitStreet(bill.street);
      const iban = settings.iban.replace(/\s/g, "");
      const reference = isQrIban(iban)
        ? createQrReference(invoice.number.replace(/\D/g, ""))
        : (invoice.paymentReference ?? undefined);
      const data: QrData = {
        currency: "CHF",
        amount: invoice.totalCents / 100,
        reference,
        message: `Rechnung ${invoice.number}`,
        creditor: {
          name: settings.companyName,
          account: iban,
          address: creditorStreet.address,
          buildingNumber: creditorStreet.buildingNumber,
          zip: settings.postalCode,
          city: settings.city,
          country: settings.country || "CH",
        },
        debtor:
          bill.street && bill.postalCode && bill.city
            ? {
                name: bill.name,
                address: debtorStreet.address,
                buildingNumber: debtorStreet.buildingNumber,
                zip: bill.postalCode,
                city: bill.city,
                country: bill.country || "CH",
              }
            : undefined,
      };
      const qrBill = new SwissQRBill(data, { language: "DE" });
      if (!SwissQRBill.isSpaceSufficient(doc)) doc.addPage();
      qrBill.attachTo(doc);
    } else {
      doc
        .fillColor("#b45309")
        .fontSize(9)
        .text(
          "Hinweis: Keine Bankverbindung hinterlegt – QR-Einzahlungsschein fehlt (Einstellungen → Firmendaten).",
          left,
          doc.page.height - (120 * MM) / 2,
          { width },
        );
      if (settings.iban) doc.text(`IBAN ${formatIban(settings.iban)}`, { width });
    }
    doc.end();
  });
}
