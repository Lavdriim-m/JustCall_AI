import {
  PAYMENT_LABELS_DE,
  formatChf,
  formatLocalTime,
  paymentMethodsSentence,
  type PaymentMethod,
} from "@justcall/core";

export type OrderSmsInput = {
  restaurantName: string;
  restaurantAddress?: string | null;
  orderNumber: number;
  customerName: string;
  fulfillment: "pickup" | "delivery";
  estimatedReadyAt: Date;
  timezone: string;
  totalCents: number;
  lines: { quantity: number; name: string; options: { optionName: string }[] }[];
  paymentMethod: PaymentMethod | null;
  paymentMethods: PaymentMethod[];
  twintPaymentUrl?: string | null;
  paymentNote?: string | null;
};

/** Characters outside the GSM-7 alphabet force UCS-2 and halve the SMS length. */
function toGsm(text: string): string {
  return text
    .replace(/[–—]/g, "-")
    .replace(/[„“”«»]/g, '"')
    .replace(/[‘’´`]/g, "'")
    .replace(/…/g, "...")
    .replace(/ß/g, "ss")
    .replace(/[âà]/g, "a")
    .replace(/[êë]/g, "e")
    .replace(/[îï]/g, "i")
    .replace(/ô/g, "o")
    .replace(/[ûù]/g, "u")
    .replace(/ç/g, "c");
}

/**
 * Order confirmation SMS in German, kept within ~3 SMS segments. Contains the order number, items,
 * total, time and payment instructions (TWINT link when the restaurant has one).
 */
export function composeOrderSms(o: OrderSmsInput): string {
  const time = formatLocalTime(o.estimatedReadyAt, o.timezone);
  const header = `${o.restaurantName}: Bestellung Nr. ${o.orderNumber} bestätigt.`;
  const lines = o.lines.map((l) => {
    const opts = l.options.map((x) => x.optionName).join(", ");
    return `${l.quantity}x ${l.name}${opts ? ` (${opts})` : ""}`;
  });
  const maxItems = 6;
  const itemText =
    lines.length > maxItems
      ? [...lines.slice(0, maxItems), `+ ${lines.length - maxItems} weitere Artikel`].join("\n")
      : lines.join("\n");
  const when =
    o.fulfillment === "delivery"
      ? `Lieferung ca. ${time} Uhr`
      : `Abholung ca. ${time} Uhr${o.restaurantAddress ? `, ${o.restaurantAddress}` : ""}`;
  const payment = o.paymentMethod
    ? `Bezahlung: ${PAYMENT_LABELS_DE[o.paymentMethod]}`
    : `Bezahlung: ${paymentMethodsSentence(o.paymentMethods)}`;
  const parts = [
    header,
    itemText,
    `Total ${formatChf(o.totalCents)}`,
    `${when}. Name: ${o.customerName}.`,
    `${payment}.${o.paymentNote ? ` ${o.paymentNote}` : ""}`,
  ];
  if (
    o.twintPaymentUrl &&
    (o.paymentMethod === "twint" || (!o.paymentMethod && o.paymentMethods.includes("twint")))
  ) {
    parts.push(`TWINT: ${o.twintPaymentUrl}`);
  }
  parts.push("Danke & en Guete!");
  return toGsm(parts.join("\n"));
}
