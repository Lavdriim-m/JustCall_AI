import "server-only";
import {
  asc,
  eq,
  inArray,
  menuCategories,
  menuItemOptionGroups,
  menuItems,
  optionGroups,
  options,
} from "@justcall/db";
import type { EditorData } from "@/components/menu/types";
import { db } from "./db";

/** Full menu (including hidden items) for the editors. */
export async function loadEditorMenu(restaurantId: string): Promise<EditorData> {
  const [categories, items, groups] = await Promise.all([
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
  ]);
  const [opts, links] = await Promise.all([
    groups.length
      ? db
          .select()
          .from(options)
          .where(
            inArray(
              options.groupId,
              groups.map((g) => g.id),
            ),
          )
          .orderBy(asc(options.sortOrder))
      : [],
    items.length
      ? db
          .select()
          .from(menuItemOptionGroups)
          .where(
            inArray(
              menuItemOptionGroups.itemId,
              items.map((i) => i.id),
            ),
          )
          .orderBy(asc(menuItemOptionGroups.sortOrder))
      : [],
  ]);
  return {
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      sortOrder: c.sortOrder,
      isActive: c.isActive,
    })),
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
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
    items: items.map((i) => ({
      id: i.id,
      categoryId: i.categoryId,
      name: i.name,
      description: i.description,
      code: i.code,
      aliases: i.aliases,
      priceCents: i.priceCents,
      tags: i.tags,
      allergens: i.allergens,
      isAvailable: i.isAvailable,
      isActive: i.isActive,
      sortOrder: i.sortOrder,
      groupIds: links.filter((l) => l.itemId === i.id).map((l) => l.groupId),
    })),
  };
}
