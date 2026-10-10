import { and, asc, eq, gte, lte, orders, restaurants, type SQL } from "@justcall/db";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { getCurrentUser, getRestaurantAccess } from "@/server/session";

export const dynamic = "force-dynamic";

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Orders as CSV (Excel compatible, semicolon separated) for reconciliation of the monthly invoice.
 *   /api/orders/export?restaurant=<id>&from=2026-09-01&to=2026-09-30
 * Admins may export everything; restaurant owners only their own restaurant.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const restaurantId = url.searchParams.get("restaurant");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const includeTests = url.searchParams.get("tests") === "1";

  if (user.role !== "admin") {
    if (!restaurantId) return NextResponse.json({ error: "restaurant required" }, { status: 400 });
    const access = await getRestaurantAccess(restaurantId);
    if (!access || access.role === "staff")
      return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const where: SQL[] = [];
  if (restaurantId) where.push(eq(orders.restaurantId, restaurantId));
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) where.push(gte(orders.orderDate, from));
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) where.push(lte(orders.orderDate, to));
  if (!includeTests) where.push(eq(orders.isTest, false));

  const rows = await db
    .select({ order: orders, restaurant: restaurants.name, timezone: restaurants.timezone })
    .from(orders)
    .innerJoin(restaurants, eq(restaurants.id, orders.restaurantId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(orders.orderDate), asc(orders.orderNumber))
    .limit(50_000);

  const header = [
    "Restaurant",
    "Datum",
    "Nr",
    "Bestellt um",
    "Kunde",
    "Telefon",
    "Art",
    "Status",
    "Zahlung",
    "Total CHF",
    "Verrechnet",
    "Test",
  ];
  const lines = rows.map(({ order: o, restaurant, timezone }) =>
    [
      restaurant,
      o.orderDate,
      o.orderNumber,
      new Intl.DateTimeFormat("de-CH", {
        timeZone: timezone,
        dateStyle: "short",
        timeStyle: "short",
      }).format(o.createdAt),
      o.customerName,
      o.customerPhone ?? "",
      o.fulfillment === "delivery" ? "Lieferung" : "Abholung",
      o.status,
      o.paymentMethod ?? "",
      (o.totalCents / 100).toFixed(2),
      o.isBillable && !o.isTest && o.status !== "cancelled" ? "ja" : "nein",
      o.isTest ? "ja" : "nein",
    ]
      .map(csvCell)
      .join(";"),
  );
  const csv = `﻿${[header.join(";"), ...lines].join("\r\n")}\r\n`;
  const name = `bestellungen${from ? `-${from}` : ""}${to ? `-${to}` : ""}.csv`;
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
