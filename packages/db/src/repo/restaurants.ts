import type { MenuSnapshot, PaymentMethod, RestaurantProfile } from "@justcall/core";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "../client";
import {
  menuCategories,
  menuItemOptionGroups,
  menuItems,
  optionGroups,
  options,
  phoneNumbers,
  restaurants,
  type Restaurant,
} from "../schema";

const PAYMENT_METHODS: PaymentMethod[] = ["cash", "card", "twint"];

/** Maps a restaurant row to the profile consumed by the conversation engine. */
export function toRestaurantProfile(r: Restaurant): RestaurantProfile {
  return {
    id: r.id,
    name: r.name,
    botName: r.botName,
    speechStyle: r.speechStyle,
    greeting: r.greeting,
    customInstructions: r.customInstructions,
    timezone: r.timezone,
    street: r.street,
    postalCode: r.postalCode,
    city: r.city,
    publicPhone: r.publicPhone,
    acceptingOrders: r.acceptingOrders && r.status !== "paused",
    pickupEnabled: r.pickupEnabled,
    deliveryEnabled: r.deliveryEnabled,
    deliveryFeeCents: r.deliveryFeeCents,
    deliveryMinOrderCents: r.deliveryMinOrderCents,
    deliveryPostalCodes: r.deliveryPostalCodes,
    prepTimeMinutes: r.prepTimeMinutes,
    deliveryTimeMinutes: r.deliveryTimeMinutes,
    extraWaitMinutes: r.extraWaitMinutes,
    allowPreorders: r.allowPreorders,
    maxItemQuantity: r.maxItemQuantity,
    openingHours: r.openingHours ?? {},
    hoursExceptions: r.hoursExceptions ?? [],
    paymentMethods: (r.paymentMethods ?? []).filter((m): m is PaymentMethod =>
      PAYMENT_METHODS.includes(m),
    ),
    twintPaymentUrl: r.twintPaymentUrl,
    paymentNote: r.paymentNote,
    allergyQuestionEnabled: r.allergyQuestionEnabled,
    transferPhone: r.transferPhone,
    transferOnAllergy: r.transferOnAllergy,
    transferOnOwnerRequest: r.transferOnOwnerRequest,
    smsEnabled: r.smsEnabled,
  };
}

export async function getRestaurant(db: Database, id: string): Promise<Restaurant | null> {
  const [row] = await db.select().from(restaurants).where(eq(restaurants.id, id)).limit(1);
  return row ?? null;
}

export async function getRestaurantBySlug(db: Database, slug: string): Promise<Restaurant | null> {
  const [row] = await db.select().from(restaurants).where(eq(restaurants.slug, slug)).limit(1);
  return row ?? null;
}

/** Finds the restaurant a dialled number (Twilio "To") is connected to. */
export async function findRestaurantByNumber(db: Database, e164: string) {
  const [row] = await db
    .select({ phoneNumber: phoneNumbers, restaurant: restaurants })
    .from(phoneNumbers)
    .leftJoin(restaurants, eq(phoneNumbers.restaurantId, restaurants.id))
    .where(and(eq(phoneNumbers.e164, e164), eq(phoneNumbers.isActive, true)))
    .limit(1);
  return row ?? null;
}

/**
 * Loads the current menu as an engine snapshot. Hidden (inactive) items and categories are
 * excluded; sold-out items are included with `isAvailable = false` so the bot can say so.
 */
export async function loadMenuSnapshot(db: Database, restaurantId: string): Promise<MenuSnapshot> {
  const [cats, items, groups] = await Promise.all([
    db
      .select()
      .from(menuCategories)
      .where(and(eq(menuCategories.restaurantId, restaurantId), eq(menuCategories.isActive, true)))
      .orderBy(asc(menuCategories.sortOrder)),
    db
      .select()
      .from(menuItems)
      .where(and(eq(menuItems.restaurantId, restaurantId), eq(menuItems.isActive, true)))
      .orderBy(asc(menuItems.sortOrder)),
    db
      .select()
      .from(optionGroups)
      .where(eq(optionGroups.restaurantId, restaurantId))
      .orderBy(asc(optionGroups.sortOrder)),
  ]);
  const groupIds = groups.map((g) => g.id);
  const itemIds = items.map((i) => i.id);
  const [opts, links] = await Promise.all([
    groupIds.length
      ? db
          .select()
          .from(options)
          .where(inArray(options.groupId, groupIds))
          .orderBy(asc(options.sortOrder))
      : Promise.resolve([]),
    itemIds.length
      ? db
          .select()
          .from(menuItemOptionGroups)
          .where(inArray(menuItemOptionGroups.itemId, itemIds))
          .orderBy(asc(menuItemOptionGroups.sortOrder))
      : Promise.resolve([]),
  ]);
  const activeCategoryIds = new Set(cats.map((c) => c.id));
  return {
    categories: cats.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      sortOrder: c.sortOrder,
    })),
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      minSelect: g.minSelect,
      maxSelect: Math.max(g.maxSelect, g.minSelect, 1),
      sortOrder: g.sortOrder,
      options: opts
        .filter((o) => o.groupId === g.id)
        .map((o) => ({
          id: o.id,
          name: o.name,
          aliases: o.aliases,
          priceDeltaCents: o.priceDeltaCents,
          isDefault: o.isDefault,
          isAvailable: o.isAvailable,
          sortOrder: o.sortOrder,
        })),
    })),
    items: items
      // Items in a hidden category are hidden too.
      .filter((i) => !i.categoryId || activeCategoryIds.has(i.categoryId))
      .map((i) => ({
        id: i.id,
        categoryId: i.categoryId,
        name: i.name,
        description: i.description,
        code: i.code,
        aliases: i.aliases,
        priceCents: i.priceCents,
        tags: i.tags,
        isAvailable: i.isAvailable,
        sortOrder: i.sortOrder,
        groupIds: links.filter((l) => l.itemId === i.id).map((l) => l.groupId),
      })),
  };
}

export type ImportedMenu = {
  categories: {
    name: string;
    description?: string | null;
    items: {
      name: string;
      description?: string | null;
      code?: string | null;
      priceCents: number;
      aliases?: string[];
      tags?: string[];
      allergens?: string[];
      optionGroups?: string[];
    }[];
  }[];
  optionGroups?: {
    name: string;
    description?: string | null;
    minSelect: number;
    maxSelect: number;
    options: { name: string; priceDeltaCents?: number; aliases?: string[]; isDefault?: boolean }[];
  }[];
};

/**
 * Imports a structured menu. With `replace = true` the existing menu is removed first (orders keep
 * their item snapshots, so history is not affected).
 */
export async function importMenu(
  db: Database,
  restaurantId: string,
  menu: ImportedMenu,
  { replace = false } = {},
) {
  return db.transaction(async (tx) => {
    if (replace) {
      await tx.delete(menuItems).where(eq(menuItems.restaurantId, restaurantId));
      await tx.delete(menuCategories).where(eq(menuCategories.restaurantId, restaurantId));
      await tx.delete(optionGroups).where(eq(optionGroups.restaurantId, restaurantId));
    }
    const groupIdByName = new Map<string, string>();
    const existingGroups = await tx
      .select()
      .from(optionGroups)
      .where(eq(optionGroups.restaurantId, restaurantId));
    for (const g of existingGroups) groupIdByName.set(g.name.toLowerCase(), g.id);

    let groupSort = existingGroups.length;
    for (const g of menu.optionGroups ?? []) {
      if (groupIdByName.has(g.name.toLowerCase())) continue;
      const [row] = await tx
        .insert(optionGroups)
        .values({
          restaurantId,
          name: g.name,
          description: g.description ?? null,
          minSelect: g.minSelect,
          maxSelect: Math.max(g.maxSelect, g.minSelect, 1),
          sortOrder: ++groupSort,
        })
        .returning();
      groupIdByName.set(g.name.toLowerCase(), row!.id);
      if (g.options.length) {
        await tx.insert(options).values(
          g.options.map((o, i) => ({
            groupId: row!.id,
            name: o.name,
            priceDeltaCents: o.priceDeltaCents ?? 0,
            aliases: o.aliases ?? [],
            isDefault: o.isDefault ?? false,
            sortOrder: i + 1,
          })),
        );
      }
    }

    const existingCats = await tx
      .select()
      .from(menuCategories)
      .where(eq(menuCategories.restaurantId, restaurantId));
    let catSort = existingCats.length;
    let itemCount = 0;
    for (const c of menu.categories) {
      let categoryId = existingCats.find((e) => e.name.toLowerCase() === c.name.toLowerCase())?.id;
      if (!categoryId) {
        const [row] = await tx
          .insert(menuCategories)
          .values({
            restaurantId,
            name: c.name,
            description: c.description ?? null,
            sortOrder: ++catSort,
          })
          .returning();
        categoryId = row!.id;
      }
      let itemSort = 0;
      for (const it of c.items) {
        const [row] = await tx
          .insert(menuItems)
          .values({
            restaurantId,
            categoryId,
            name: it.name,
            description: it.description ?? null,
            code: it.code ?? null,
            priceCents: it.priceCents,
            aliases: it.aliases ?? [],
            tags: it.tags ?? [],
            allergens: it.allergens ?? [],
            sortOrder: ++itemSort,
          })
          .returning();
        itemCount += 1;
        const links = (it.optionGroups ?? [])
          .map((name) => groupIdByName.get(name.toLowerCase()))
          .filter((id): id is string => !!id);
        if (links.length) {
          await tx
            .insert(menuItemOptionGroups)
            .values(links.map((groupId, i) => ({ itemId: row!.id, groupId, sortOrder: i })))
            .onConflictDoNothing();
        }
      }
    }
    return {
      items: itemCount,
      categories: menu.categories.length,
      groups: menu.optionGroups?.length ?? 0,
    };
  });
}

/** Exports the full menu in the import format (round-trippable). */
export async function exportMenu(db: Database, restaurantId: string): Promise<ImportedMenu> {
  const [cats, items, groups, links] = await Promise.all([
    db
      .select()
      .from(menuCategories)
      .where(eq(menuCategories.restaurantId, restaurantId))
      .orderBy(asc(menuCategories.sortOrder)),
    db
      .select()
      .from(menuItems)
      .where(eq(menuItems.restaurantId, restaurantId))
      .orderBy(asc(menuItems.sortOrder)),
    db
      .select()
      .from(optionGroups)
      .where(eq(optionGroups.restaurantId, restaurantId))
      .orderBy(asc(optionGroups.sortOrder)),
    db
      .select({ itemId: menuItemOptionGroups.itemId, groupId: menuItemOptionGroups.groupId })
      .from(menuItemOptionGroups)
      .innerJoin(menuItems, eq(menuItems.id, menuItemOptionGroups.itemId))
      .where(eq(menuItems.restaurantId, restaurantId)),
  ]);
  const groupIds = groups.map((g) => g.id);
  const opts = groupIds.length
    ? await db
        .select()
        .from(options)
        .where(inArray(options.groupId, groupIds))
        .orderBy(asc(options.sortOrder))
    : [];
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const toItem = (i: (typeof items)[number]) => ({
    name: i.name,
    description: i.description,
    code: i.code,
    priceCents: i.priceCents,
    aliases: i.aliases,
    tags: i.tags,
    allergens: i.allergens,
    optionGroups: links
      .filter((l) => l.itemId === i.id)
      .map((l) => groupName.get(l.groupId)!)
      .filter(Boolean),
  });
  const categories = cats.map((c) => ({
    name: c.name,
    description: c.description,
    items: items.filter((i) => i.categoryId === c.id).map(toItem),
  }));
  const uncategorised = items.filter((i) => !i.categoryId);
  if (uncategorised.length)
    categories.push({ name: "Weitere", description: null, items: uncategorised.map(toItem) });
  return {
    categories,
    optionGroups: groups.map((g) => ({
      name: g.name,
      description: g.description,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      options: opts
        .filter((o) => o.groupId === g.id)
        .map((o) => ({
          name: o.name,
          priceDeltaCents: o.priceDeltaCents,
          aliases: o.aliases,
          isDefault: o.isDefault,
        })),
    })),
  };
}
