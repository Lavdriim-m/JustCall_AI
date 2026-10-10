import { demoMenu } from "@justcall/core/fixtures";
import {
  createDb,
  importMenu,
  phoneNumbers,
  restaurants,
  runMigrations,
  sql,
  type ImportedMenu,
} from "@justcall/db";

export const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5433/justcall_test";

export async function resetTestDatabase() {
  const { db, client } = createDb({ url: TEST_DB_URL, max: 1 });
  await runMigrations(db);
  await db.execute(
    sql`truncate table call_events, calls, order_items, orders, order_counters, invoice_lines, invoices, invoice_counters, job_runs, phone_numbers, menu_item_option_groups, options, option_groups, menu_items, menu_categories, memberships, restaurants restart identity cascade`,
  );
  await client.end();
}

export function demoMenuImport(): ImportedMenu {
  const groupName = new Map(demoMenu.groups.map((g) => [g.id, g.name]));
  return {
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
          code: i.code,
          priceCents: i.priceCents,
          aliases: i.aliases,
          tags: i.tags,
          optionGroups: i.groupIds.map((g) => groupName.get(g)!),
        })),
    })),
  };
}

export async function createTestRestaurant(
  number: string,
  overrides: Partial<typeof restaurants.$inferInsert> = {},
) {
  const { db, client } = createDb({ url: TEST_DB_URL, max: 1 });
  const [restaurant] = await db
    .insert(restaurants)
    .values({
      slug: `test-${Math.random().toString(36).slice(2, 8)}`,
      name: "Pizzeria Test",
      status: "active",
      openingHours: {},
      paymentMethods: ["cash", "twint"],
      transferPhone: "+41791112233",
      street: "Teststrasse 1",
      city: "Zürich",
      ...overrides,
    })
    .returning();
  await importMenu(db, restaurant!.id, demoMenuImport());
  await db.insert(phoneNumbers).values({ e164: number, restaurantId: restaurant!.id });
  await client.end();
  return restaurant!;
}
