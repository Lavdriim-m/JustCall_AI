"use server";

import {
  WEEKDAYS,
  isValidRange,
  parseTime,
  slugify,
  toE164,
  type HoursException,
  type WeeklyHours,
} from "@justcall/core";
import { and, eq, getPlatformSettings, ne, restaurants } from "@justcall/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "../audit";
import { db } from "../db";
import { requireAdmin, requireRestaurantAccess } from "../session";
import { invalidateVoiceCache } from "../voice";
import {
  checkbox,
  chfToCents,
  fail,
  firstError,
  formToObject,
  intField,
  ok,
  optionalText,
  percentToBps,
  type ActionResult,
} from "./helpers";

const phone = (label: string) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z
      .string()
      .nullable()
      .optional()
      .transform((v, ctx) => {
        if (!v) return null;
        const e164 = toE164(v);
        if (!e164) {
          ctx.addIssue({ code: "custom", message: `${label}: invalid phone number` });
          return z.NEVER;
        }
        return e164;
      }),
  );

const list = z.preprocess(
  (v) =>
    typeof v === "string"
      ? v
          .split(/[,;\n]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : (v ?? []),
  z.array(z.string().max(200)).max(200),
);

const sections = {
  general: z.object({
    name: z.string().trim().min(2).max(120),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9-]{3,60}$/, "Slug: 3–60 characters, a–z, 0–9 and dashes"),
    legalName: optionalText,
    street: optionalText,
    postalCode: optionalText,
    city: optionalText,
    contactName: optionalText,
    contactEmail: z.preprocess((v) => (v === "" ? null : v), z.email().nullable().optional()),
    contactPhone: phone("Contact phone"),
    publicPhone: phone("Public phone"),
    notes: optionalText,
  }),
  bot: z.object({
    botName: z.string().trim().min(1).max(40),
    speechStyle: z.enum(["swiss_standard", "swiss_dialect"]),
    greeting: optionalText,
    customInstructions: optionalText,
    ttsProvider: optionalText,
    ttsVoice: optionalText,
    sttProvider: optionalText,
    llmModel: optionalText,
  }),
  ordering: z.object({
    acceptingOrders: checkbox,
    pickupEnabled: checkbox,
    deliveryEnabled: checkbox,
    deliveryFeeCents: chfToCents,
    deliveryMinOrderCents: chfToCents,
    deliveryPostalCodes: list,
    prepTimeMinutes: intField(0, 240),
    deliveryTimeMinutes: intField(0, 300),
    extraWaitMinutes: intField(0, 180),
    allowPreorders: checkbox,
    maxItemQuantity: intField(1, 100),
  }),
  payment: z.object({
    paymentMethods: z
      .array(z.enum(["cash", "card", "twint"]))
      .min(1, "Select at least one payment method"),
    twintPaymentUrl: z.preprocess((v) => (v === "" ? null : v), z.url().nullable().optional()),
    paymentNote: optionalText,
  }),
  safety: z.object({
    allergyQuestionEnabled: checkbox,
    transferPhone: phone("Transfer number"),
    transferOnAllergy: checkbox,
    transferOnOwnerRequest: checkbox,
  }),
  notifications: z.object({
    smsEnabled: checkbox,
    smsSenderName: optionalText,
    orderNotificationEmails: list.pipe(z.array(z.email("Invalid notification email"))),
  }),
  billing: z.object({
    commissionBps: percentToBps,
    monthlyFeeCents: chfToCents,
    perOrderFeeCents: chfToCents,
    billingName: optionalText,
    billingEmail: z.preprocess((v) => (v === "" ? null : v), z.email().nullable().optional()),
    billingStreet: optionalText,
    billingPostalCode: optionalText,
    billingCity: optionalText,
    billingCountry: z.string().trim().length(2).default("CH"),
    billingStartsOn: z.preprocess((v) => (v === "" ? null : v), z.iso.date().nullable().optional()),
  }),
} as const;

export type RestaurantSection = keyof typeof sections;

export async function createRestaurant(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const data = formToObject(formData);
  const name = String(data.name ?? "").trim();
  if (name.length < 2) return fail("Please enter the restaurant name.");
  let slug = slugify(String(data.slug || name));
  for (let i = 2; ; i++) {
    const [exists] = await db
      .select({ id: restaurants.id })
      .from(restaurants)
      .where(eq(restaurants.slug, slug))
      .limit(1);
    if (!exists) break;
    slug = `${slugify(name)}-${i}`;
  }
  const settings = await getPlatformSettings(db);
  const [created] = await db
    .insert(restaurants)
    .values({
      name,
      slug,
      city: String(data.city ?? "").trim() || null,
      contactName: String(data.contactName ?? "").trim() || null,
      contactEmail: String(data.contactEmail ?? "").trim() || null,
      publicPhone: toE164(String(data.publicPhone ?? "")),
      commissionBps: settings.defaultCommissionBps,
      monthlyFeeCents: settings.defaultMonthlyFeeCents,
      status: "draft",
    })
    .returning();
  await audit(admin.id, "restaurant.create", {
    restaurantId: created!.id,
    entity: "restaurant",
    entityId: created!.id,
  });
  redirect(`/admin/restaurants/${created!.id}`);
}

export async function updateRestaurant(
  id: string,
  section: RestaurantSection,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const access = await requireRestaurantAccess(id, "owner");
  // Restaurant owners may change operational settings, admins everything.
  if (access.role !== "admin" && !["ordering", "notifications", "payment"].includes(section)) {
    return fail("Only JustCall administrators can change these settings.");
  }
  const schema = sections[section];
  const raw = formToObject(formData);
  if (section === "payment" && !raw.paymentMethods) raw.paymentMethods = [];
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return fail(firstError(parsed.error));
  const values = parsed.data as Record<string, unknown>;

  if (section === "general") {
    const [clash] = await db
      .select({ id: restaurants.id })
      .from(restaurants)
      .where(and(eq(restaurants.slug, values.slug as string), ne(restaurants.id, id)))
      .limit(1);
    if (clash) return fail("This slug is already used by another restaurant.");
  }
  if (
    section === "safety" &&
    values.transferPhone &&
    values.transferPhone === access.restaurant.publicPhone
  ) {
    return fail(
      "The transfer number must differ from the restaurant's public number – that number is forwarded to JustCall and would create a loop.",
    );
  }
  if (section === "notifications" && typeof values.smsSenderName === "string") {
    const s = values.smsSenderName;
    if (!/^\+\d+$/.test(s) && !/^[A-Za-z0-9 ]{1,11}$/.test(s)) {
      return fail("SMS sender name: max. 11 letters/digits (no umlauts) or a phone number.");
    }
  }

  await db.update(restaurants).set(values).where(eq(restaurants.id, id));
  await audit(access.user.id, `restaurant.update.${section}`, { restaurantId: id, data: values });
  await invalidateVoiceCache(id);
  revalidatePath(`/admin/restaurants/${id}`, "layout");
  revalidatePath(`/r/${access.restaurant.slug}`, "layout");
  return ok();
}

export async function setRestaurantStatus(
  id: string,
  status: "draft" | "active" | "paused" | "archived",
) {
  const admin = await requireAdmin();
  await db.update(restaurants).set({ status }).where(eq(restaurants.id, id));
  await audit(admin.id, "restaurant.status", { restaurantId: id, data: { status } });
  await invalidateVoiceCache(id);
  revalidatePath(`/admin/restaurants/${id}`, "layout");
  revalidatePath("/admin/restaurants");
}

/** Quick toggles used by the restaurant portal (bot on/off, extra waiting time). */
export async function setOperationalState(
  id: string,
  patch: { acceptingOrders?: boolean; extraWaitMinutes?: number },
) {
  const access = await requireRestaurantAccess(id, "staff");
  const values: { acceptingOrders?: boolean; extraWaitMinutes?: number } = {};
  if (typeof patch.acceptingOrders === "boolean") values.acceptingOrders = patch.acceptingOrders;
  if (typeof patch.extraWaitMinutes === "number")
    values.extraWaitMinutes = Math.max(0, Math.min(180, Math.round(patch.extraWaitMinutes)));
  await db.update(restaurants).set(values).where(eq(restaurants.id, id));
  await audit(access.user.id, "restaurant.operational", { restaurantId: id, data: values });
  await invalidateVoiceCache(id);
  revalidatePath(`/r/${access.restaurant.slug}`, "layout");
  revalidatePath(`/admin/restaurants/${id}`, "layout");
}

const rangeSchema = z.object({ open: z.string(), close: z.string() });
const hoursSchema = z.object({
  weekly: z.record(z.enum(WEEKDAYS as [string, ...string[]]), z.array(rangeSchema).max(4)),
  exceptions: z
    .array(
      z.object({
        date: z.iso.date(),
        ranges: z.array(rangeSchema).max(4),
        note: z.string().max(100).optional(),
      }),
    )
    .max(100),
});

export async function updateOpeningHours(id: string, payload: unknown): Promise<ActionResult> {
  const access = await requireRestaurantAccess(id, "owner");
  const parsed = hoursSchema.safeParse(payload);
  if (!parsed.success) return fail(firstError(parsed.error));
  const validate = (ranges: { open: string; close: string }[]) =>
    ranges.every(
      (r) => parseTime(r.open) !== null && parseTime(r.close) !== null && isValidRange(r),
    );
  for (const [day, ranges] of Object.entries(parsed.data.weekly)) {
    if (!validate(ranges))
      return fail(`Invalid time range on ${day}. Use HH:MM, e.g. 11:00–14:00.`);
  }
  for (const ex of parsed.data.exceptions) {
    if (!validate(ex.ranges)) return fail(`Invalid time range on ${ex.date}.`);
  }
  await db
    .update(restaurants)
    .set({
      openingHours: parsed.data.weekly as WeeklyHours,
      hoursExceptions: [...parsed.data.exceptions].sort((a, b) =>
        a.date.localeCompare(b.date),
      ) as HoursException[],
    })
    .where(eq(restaurants.id, id));
  await audit(access.user.id, "restaurant.hours", { restaurantId: id });
  await invalidateVoiceCache(id);
  revalidatePath(`/admin/restaurants/${id}`, "layout");
  return ok("Opening hours saved");
}
