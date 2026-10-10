"use server";

import { normalize } from "@justcall/core";
import {
  and,
  eq,
  exportMenu,
  importMenu,
  inArray,
  menuCategories,
  menuItemOptionGroups,
  menuItems,
  ne,
  optionGroups,
  options,
  type ImportedMenu,
} from "@justcall/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "../audit";
import { db } from "../db";
import { requireRestaurantAccess } from "../session";
import { invalidateVoiceCache } from "../voice";
import { fail, firstError, ok, type ActionResult } from "./helpers";

async function done(restaurantId: string, slug: string) {
  await invalidateVoiceCache(restaurantId);
  revalidatePath(`/admin/restaurants/${restaurantId}/menu`);
  revalidatePath(`/r/${slug}/menu`);
}

const stringList = z.array(z.string().trim().min(1).max(120)).max(50).default([]);

/* --------------------------------- Categories -------------------------------- */

const categorySchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  isActive: z.boolean().default(true),
});

export async function saveCategory(
  restaurantId: string,
  input: z.input<typeof categorySchema>,
): Promise<ActionResult> {
  const access = await requireRestaurantAccess(restaurantId, "owner");
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return fail(firstError(parsed.error));
  const { id, ...values } = parsed.data;
  if (id) {
    await db
      .update(menuCategories)
      .set(values)
      .where(and(eq(menuCategories.id, id), eq(menuCategories.restaurantId, restaurantId)));
  } else {
    const existing = await db
      .select({ id: menuCategories.id })
      .from(menuCategories)
      .where(eq(menuCategories.restaurantId, restaurantId));
    await db
      .insert(menuCategories)
      .values({ ...values, restaurantId, sortOrder: existing.length + 1 });
  }
  await audit(access.user.id, "menu.category.save", { restaurantId, data: values });
  await done(restaurantId, access.restaurant.slug);
  return ok("Category saved");
}

export async function deleteCategory(restaurantId: string, id: string): Promise<ActionResult> {
  const access = await requireRestaurantAccess(restaurantId, "owner");
  await db
    .delete(menuCategories)
    .where(and(eq(menuCategories.id, id), eq(menuCategories.restaurantId, restaurantId)));
  await audit(access.user.id, "menu.category.delete", { restaurantId, entityId: id });
  await done(restaurantId, access.restaurant.slug);
  return ok("Category deleted – its items are now uncategorised");
}

export async function moveCategory(
  restaurantId: string,
  id: string,
  direction: -1 | 1,
): Promise<ActionResult> {
  const access = await requireRestaurantAccess(restaurantId, "owner");
  const cats = await db
    .select()
    .from(menuCategories)
    .where(eq(menuCategories.restaurantId, restaurantId))
    .orderBy(menuCategories.sortOrder);
  const idx = cats.findIndex((c) => c.id === id);
  const swap = cats[idx + direction];
  if (idx < 0 || !swap) return ok();
  const ordered = [...cats];
  ordered[idx] = swap;
  ordered[idx + direction] = cats[idx]!;
  await db.transaction(async (tx) => {
    for (const [i, c] of ordered.entries())
      await tx
        .update(menuCategories)
        .set({ sortOrder: i + 1 })
        .where(eq(menuCategories.id, c.id));
  });
  await done(restaurantId, access.restaurant.slug);
  return ok("Order updated");
}

/* ----------------------------------- Items ----------------------------------- */

const itemSchema = z.object({
  id: z.uuid().optional(),
  categoryId: z.uuid().nullable(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  code: z.string().trim().max(20).nullable().optional(),
  aliases: stringList,
  priceCents: z.number().int().min(0).max(1_000_000),
  tags: stringList,
  allergens: stringList,
  isAvailable: z.boolean().default(true),
  isActive: z.boolean().default(true),
  groupIds: z.array(z.uuid()).max(20).default([]),
});

/** Finds aliases/names/codes that collide with other items (they would make matching ambiguous). */
async function findConflicts(
  restaurantId: string,
  itemId: string | undefined,
  names: string[],
  code: string | null | undefined,
) {
  const others = await db
    .select({
      id: menuItems.id,
      name: menuItems.name,
      aliases: menuItems.aliases,
      code: menuItems.code,
    })
    .from(menuItems)
    .where(
      and(
        eq(menuItems.restaurantId, restaurantId),
        eq(menuItems.isActive, true),
        itemId ? ne(menuItems.id, itemId) : undefined,
      ),
    );
  const conflicts: string[] = [];
  const wanted = new Map(names.map((n) => [normalize(n), n]));
  for (const o of others) {
    for (const n of [o.name, ...o.aliases]) {
      const hit = wanted.get(normalize(n));
      if (hit) conflicts.push(`"${hit}" is also used by ${o.name}`);
    }
    if (code && o.code && normalize(o.code) === normalize(code))
      conflicts.push(`Code ${code} is also used by ${o.name}`);
  }
  return conflicts;
}

export async function saveItem(
  restaurantId: string,
  input: z.input<typeof itemSchema>,
): Promise<ActionResult> {
  const access = await requireRestaurantAccess(restaurantId, "owner");
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) return fail(firstError(parsed.error));
  const { id, groupIds, ...values } = parsed.data;
  const aliases = [...new Map(values.aliases.map((a) => [normalize(a), a])).values()].filter(
    (a) => normalize(a) !== normalize(values.name),
  );
  const conflicts = await findConflicts(restaurantId, id, [values.name, ...aliases], values.code);
  if (conflicts.some((c) => c.startsWith("Code")))
    return fail(conflicts.find((c) => c.startsWith("Code"))!);

  // Option groups must belong to this restaurant.
  const validGroups = groupIds.length
    ? (
        await db
          .select({ id: optionGroups.id })
          .from(optionGroups)
          .where(
            and(eq(optionGroups.restaurantId, restaurantId), inArray(optionGroups.id, groupIds)),
          )
      ).map((g) => g.id)
    : [];

  const itemId = await db.transaction(async (tx) => {
    let rowId = id;
    if (id) {
      await tx
        .update(menuItems)
        .set({ ...values, aliases, code: values.code || null })
        .where(and(eq(menuItems.id, id), eq(menuItems.restaurantId, restaurantId)));
    } else {
      const siblings = await tx
        .select({ id: menuItems.id })
        .from(menuItems)
        .where(eq(menuItems.restaurantId, restaurantId));
      const [row] = await tx
        .insert(menuItems)
        .values({
          ...values,
          aliases,
          code: values.code || null,
          restaurantId,
          sortOrder: siblings.length + 1,
        })
        .returning({ id: menuItems.id });
      rowId = row!.id;
    }
    await tx.delete(menuItemOptionGroups).where(eq(menuItemOptionGroups.itemId, rowId!));
    if (validGroups.length) {
      await tx
        .insert(menuItemOptionGroups)
        .values(
          groupIds
            .filter((g) => validGroups.includes(g))
            .map((groupId, i) => ({ itemId: rowId!, groupId, sortOrder: i })),
        );
    }
    return rowId!;
  });
  await audit(access.user.id, id ? "menu.item.update" : "menu.item.create", {
    restaurantId,
    entity: "menu_item",
    entityId: itemId,
    data: values,
  });
  await done(restaurantId, access.restaurant.slug);
  return conflicts.length
    ? {
        ok: true,
        message: `Saved – warning: ${conflicts.join("; ")}. The assistant will ask which one is meant.`,
      }
    : ok("Item saved");
}

export async function deleteItem(restaurantId: string, id: string): Promise<ActionResult> {
  const access = await requireRestaurantAccess(restaurantId, "owner");
  await db
    .delete(menuItems)
    .where(and(eq(menuItems.id, id), eq(menuItems.restaurantId, restaurantId)));
  await audit(access.user.id, "menu.item.delete", { restaurantId, entityId: id });
  await done(restaurantId, access.restaurant.slug);
  return ok("Item deleted");
}

/** Sold-out toggle – allowed for restaurant staff. */
export async function setItemAvailability(
  restaurantId: string,
  id: string,
  isAvailable: boolean,
): Promise<ActionResult> {
  const access = await requireRestaurantAccess(restaurantId, "staff");
  await db
    .update(menuItems)
    .set({ isAvailable })
    .where(and(eq(menuItems.id, id), eq(menuItems.restaurantId, restaurantId)));
  await audit(access.user.id, "menu.item.availability", {
    restaurantId,
    entityId: id,
    data: { isAvailable },
  });
  await done(restaurantId, access.restaurant.slug);
  return ok(isAvailable ? "Available again" : "Marked as sold out");
}

export async function setOptionAvailability(
  restaurantId: string,
  optionId: string,
  isAvailable: boolean,
): Promise<ActionResult> {
  const access = await requireRestaurantAccess(restaurantId, "staff");
  const [opt] = await db
    .select({ id: options.id })
    .from(options)
    .innerJoin(optionGroups, eq(optionGroups.id, options.groupId))
    .where(and(eq(options.id, optionId), eq(optionGroups.restaurantId, restaurantId)))
    .limit(1);
  if (!opt) return fail("Option not found");
  await db.update(options).set({ isAvailable }).where(eq(options.id, optionId));
  await done(restaurantId, access.restaurant.slug);
  return ok(isAvailable ? "Available again" : "Marked as sold out");
}

export async function moveItem(
  restaurantId: string,
  id: string,
  direction: -1 | 1,
): Promise<ActionResult> {
  const access = await requireRestaurantAccess(restaurantId, "owner");
  const [item] = await db
    .select()
    .from(menuItems)
    .where(and(eq(menuItems.id, id), eq(menuItems.restaurantId, restaurantId)))
    .limit(1);
  if (!item) return fail("Item not found");
  const siblings = await db
    .select()
    .from(menuItems)
    .where(
      and(
        eq(menuItems.restaurantId, restaurantId),
        item.categoryId ? eq(menuItems.categoryId, item.categoryId) : undefined,
      ),
    )
    .orderBy(menuItems.sortOrder, menuItems.name);
  const list = item.categoryId ? siblings : siblings.filter((s) => !s.categoryId);
  const idx = list.findIndex((s) => s.id === id);
  const swap = list[idx + direction];
  if (!swap) return ok();
  const ordered = [...list];
  ordered[idx] = swap;
  ordered[idx + direction] = item;
  await db.transaction(async (tx) => {
    for (const [i, s] of ordered.entries())
      await tx
        .update(menuItems)
        .set({ sortOrder: i + 1 })
        .where(eq(menuItems.id, s.id));
  });
  await done(restaurantId, access.restaurant.slug);
  return ok("Order updated");
}

/* -------------------------------- Option groups -------------------------------- */

const groupSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(300).nullable().optional(),
    minSelect: z.number().int().min(0).max(20),
    maxSelect: z.number().int().min(1).max(20),
    options: z
      .array(
        z.object({
          id: z.uuid().optional(),
          name: z.string().trim().min(1).max(80),
          priceDeltaCents: z.number().int().min(-100_000).max(100_000),
          aliases: stringList,
          isDefault: z.boolean().default(false),
          isAvailable: z.boolean().default(true),
        }),
      )
      .min(1, "Add at least one option")
      .max(60),
  })
  .refine((g) => g.maxSelect >= g.minSelect, { message: "Max must be ≥ min" });

export async function saveOptionGroup(
  restaurantId: string,
  input: z.input<typeof groupSchema>,
): Promise<ActionResult> {
  const access = await requireRestaurantAccess(restaurantId, "owner");
  const parsed = groupSchema.safeParse(input);
  if (!parsed.success) return fail(firstError(parsed.error));
  const { id, options: opts, ...values } = parsed.data;
  await db.transaction(async (tx) => {
    let groupId = id;
    if (id) {
      const [g] = await tx
        .select()
        .from(optionGroups)
        .where(and(eq(optionGroups.id, id), eq(optionGroups.restaurantId, restaurantId)))
        .limit(1);
      if (!g) throw new Error("Option group not found");
      await tx.update(optionGroups).set(values).where(eq(optionGroups.id, id));
    } else {
      const existing = await tx
        .select({ id: optionGroups.id })
        .from(optionGroups)
        .where(eq(optionGroups.restaurantId, restaurantId));
      const [row] = await tx
        .insert(optionGroups)
        .values({ ...values, restaurantId, sortOrder: existing.length + 1 })
        .returning({ id: optionGroups.id });
      groupId = row!.id;
    }
    const current = await tx
      .select({ id: options.id })
      .from(options)
      .where(eq(options.groupId, groupId!));
    const keep = new Set(opts.filter((o) => o.id).map((o) => o.id!));
    const remove = current.filter((c) => !keep.has(c.id)).map((c) => c.id);
    if (remove.length) await tx.delete(options).where(inArray(options.id, remove));
    for (const [i, o] of opts.entries()) {
      const row = {
        name: o.name,
        priceDeltaCents: o.priceDeltaCents,
        aliases: o.aliases,
        isDefault: o.isDefault,
        isAvailable: o.isAvailable,
        sortOrder: i + 1,
      };
      if (o.id && current.some((c) => c.id === o.id))
        await tx.update(options).set(row).where(eq(options.id, o.id));
      else await tx.insert(options).values({ ...row, groupId: groupId! });
    }
  });
  await audit(access.user.id, "menu.group.save", { restaurantId, data: values });
  await done(restaurantId, access.restaurant.slug);
  return ok("Option group saved");
}

export async function deleteOptionGroup(restaurantId: string, id: string): Promise<ActionResult> {
  const access = await requireRestaurantAccess(restaurantId, "owner");
  await db
    .delete(optionGroups)
    .where(and(eq(optionGroups.id, id), eq(optionGroups.restaurantId, restaurantId)));
  await done(restaurantId, access.restaurant.slug);
  return ok("Option group deleted");
}

/* ------------------------------- Import / export ------------------------------- */

const importSchema = z.object({
  categories: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        description: z.string().nullable().optional(),
        items: z
          .array(
            z.object({
              name: z.string().trim().min(1).max(120),
              description: z.string().nullable().optional(),
              code: z.string().nullable().optional(),
              priceCents: z.number().int().min(0),
              aliases: z.array(z.string()).optional(),
              tags: z.array(z.string()).optional(),
              allergens: z.array(z.string()).optional(),
              optionGroups: z.array(z.string()).optional(),
            }),
          )
          .max(500),
      }),
    )
    .max(100),
  optionGroups: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        description: z.string().nullable().optional(),
        minSelect: z.number().int().min(0),
        maxSelect: z.number().int().min(1),
        options: z.array(
          z.object({
            name: z.string().trim().min(1),
            priceDeltaCents: z.number().int().optional(),
            aliases: z.array(z.string()).optional(),
            isDefault: z.boolean().optional(),
          }),
        ),
      }),
    )
    .optional(),
});

export async function importMenuAction(
  restaurantId: string,
  menu: unknown,
  replace: boolean,
): Promise<ActionResult> {
  const access = await requireRestaurantAccess(restaurantId, "owner");
  const parsed = importSchema.safeParse(menu);
  if (!parsed.success) return fail(`Invalid menu format – ${firstError(parsed.error)}`);
  const result = await importMenu(db, restaurantId, parsed.data as ImportedMenu, { replace });
  await audit(access.user.id, "menu.import", { restaurantId, data: { ...result, replace } });
  await done(restaurantId, access.restaurant.slug);
  return ok(`Imported ${result.items} items in ${result.categories} categories`);
}

export async function exportMenuAction(restaurantId: string): Promise<ImportedMenu> {
  await requireRestaurantAccess(restaurantId, "owner");
  return exportMenu(db, restaurantId);
}
