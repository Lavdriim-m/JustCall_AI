/**
 * Seeds a demo restaurant ("Pizzeria Bella Vista") with a complete menu so the simulator and the
 * dashboards can be tried out immediately.
 *
 *   pnpm db:seed            # creates the demo restaurant if it does not exist
 *   pnpm db:seed --reset    # deletes and recreates it (including its orders and calls)
 */
import "./env";
import { demoMenu, demoRestaurant } from "@justcall/core/fixtures";
import { eq } from "drizzle-orm";
import { createDb } from "./client";
import { importMenu, type ImportedMenu } from "./repo/restaurants";
import { calls, orders, platformSettings, restaurants } from "./schema";

const SLUG = "pizzeria-bella-vista";

async function main() {
  const reset = process.argv.includes("--reset");
  const { db, client } = createDb({ max: 1 });

  await db.insert(platformSettings).values({ id: 1 }).onConflictDoNothing();

  const [existing] = await db.select().from(restaurants).where(eq(restaurants.slug, SLUG)).limit(1);
  if (existing && !reset) {
    console.log(`Demo restaurant already exists (${existing.id}). Use --reset to recreate it.`);
    await client.end();
    return;
  }
  if (existing) {
    await db.delete(orders).where(eq(orders.restaurantId, existing.id));
    await db.delete(calls).where(eq(calls.restaurantId, existing.id));
    await db.delete(restaurants).where(eq(restaurants.id, existing.id));
  }

  const r = demoRestaurant;
  const [restaurant] = await db
    .insert(restaurants)
    .values({
      slug: SLUG,
      name: r.name,
      status: "active",
      legalName: "Bella Vista Gastro GmbH",
      street: r.street,
      postalCode: r.postalCode,
      city: r.city,
      contactName: "Marco Rossi",
      contactEmail: "marco@bellavista.example",
      contactPhone: "+41791112233",
      publicPhone: r.publicPhone,
      timezone: r.timezone,
      botName: r.botName,
      speechStyle: r.speechStyle,
      customInstructions: r.customInstructions,
      acceptingOrders: true,
      pickupEnabled: r.pickupEnabled,
      deliveryEnabled: r.deliveryEnabled,
      deliveryFeeCents: r.deliveryFeeCents,
      deliveryMinOrderCents: r.deliveryMinOrderCents,
      deliveryPostalCodes: r.deliveryPostalCodes,
      prepTimeMinutes: r.prepTimeMinutes,
      deliveryTimeMinutes: r.deliveryTimeMinutes,
      allowPreorders: r.allowPreorders,
      openingHours: r.openingHours,
      hoursExceptions: r.hoursExceptions,
      paymentMethods: r.paymentMethods,
      allergyQuestionEnabled: true,
      transferPhone: r.transferPhone,
      smsEnabled: true,
      smsSenderName: "BellaVista",
      commissionBps: 500,
      monthlyFeeCents: 4900,
      billingName: "Bella Vista Gastro GmbH",
      billingEmail: "buchhaltung@bellavista.example",
      billingStreet: r.street,
      billingPostalCode: r.postalCode,
      billingCity: r.city,
    })
    .returning();

  const groupName = new Map(demoMenu.groups.map((g) => [g.id, g.name]));
  const menu: ImportedMenu = {
    optionGroups: demoMenu.groups.map((g) => ({
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      options: g.options.map((o) => ({
        name: o.name,
        priceDeltaCents: o.priceDeltaCents,
        aliases: o.aliases,
        isDefault: o.isDefault,
      })),
    })),
    categories: demoMenu.categories.map((c) => ({
      name: c.name,
      items: demoMenu.items
        .filter((i) => i.categoryId === c.id)
        .map((i) => ({
          name: i.name,
          description: i.description,
          code: i.code,
          priceCents: i.priceCents,
          aliases: i.aliases,
          tags: i.tags,
          optionGroups: i.groupIds.map((g) => groupName.get(g)!),
        })),
    })),
  };
  const result = await importMenu(db, restaurant!.id, menu);
  console.log(
    `Created demo restaurant "${restaurant!.name}" (${restaurant!.id}) with ${result.items} items, ${result.groups} option groups.`,
  );
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
