import { PAYMENT_LABELS_DE, formatChf, formatLocalTime, type PaymentMethod } from "@justcall/core";
import type { Order, OrderItem, Restaurant } from "@justcall/db";
import { sendMail } from "./mailer";

/** Optional email to the restaurant for every new order (in addition to the live orders board). */
export async function notifyRestaurantByEmail(
  restaurant: Restaurant,
  order: Order,
  items: Pick<OrderItem, "quantity" | "name" | "options" | "notes">[],
  appUrl?: string,
) {
  const to = restaurant.orderNotificationEmails.filter(Boolean);
  if (!to.length) return { skipped: true as const };
  const time = order.estimatedReadyAt
    ? formatLocalTime(order.estimatedReadyAt, restaurant.timezone)
    : "so schnell wie möglich";
  const lines = items.map((i) => {
    const opts = i.options.map((o) => o.optionName).join(", ");
    return `${i.quantity}x ${i.name}${opts ? ` (${opts})` : ""}${i.notes ? ` – ${i.notes}` : ""}`;
  });
  const address = order.deliveryAddress
    ? `${order.deliveryAddress.street}, ${[order.deliveryAddress.postalCode, order.deliveryAddress.city].filter(Boolean).join(" ")}${order.deliveryAddress.notes ? ` (${order.deliveryAddress.notes})` : ""}`
    : null;
  const text = [
    `Neue telefonische Bestellung Nr. ${order.orderNumber}`,
    ``,
    ...lines,
    ``,
    `Total: ${formatChf(order.totalCents)}`,
    `${order.fulfillment === "delivery" ? "Lieferung" : "Abholung"}: ca. ${time} Uhr`,
    address ? `Adresse: ${address}` : null,
    `Name: ${order.customerName}`,
    order.customerPhone ? `Telefon: ${order.customerPhone}` : null,
    order.paymentMethod
      ? `Zahlung: ${PAYMENT_LABELS_DE[order.paymentMethod as PaymentMethod] ?? order.paymentMethod}`
      : null,
    order.notes ? `Bemerkung: ${order.notes}` : null,
    appUrl ? `\nLive-Bestellungen: ${appUrl.replace(/\/$/, "")}/r/${restaurant.slug}/orders` : null,
  ]
    .filter((l) => l !== null)
    .join("\n");
  await sendMail({
    to,
    subject: `Neue Bestellung Nr. ${order.orderNumber} – ${order.customerName}`,
    text,
  });
  return { skipped: false as const };
}
