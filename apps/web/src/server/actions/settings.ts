"use server";

import { eq, platformSettings } from "@justcall/db";
import { isValidIban } from "@justcall/core";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "../audit";
import { db } from "../db";
import { requireAdmin } from "../session";
import {
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

const schema = z.object({
  companyName: z.string().trim().min(2).max(120),
  street: optionalText,
  postalCode: optionalText,
  city: optionalText,
  country: z.string().trim().length(2).default("CH"),
  email: z.preprocess((v) => (v === "" ? null : v), z.email().nullable().optional()),
  phone: optionalText,
  website: optionalText,
  vatNumber: optionalText,
  vatRateBps: percentToBps,
  iban: optionalText,
  invoicePrefix: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{1,6}$/i, "Invoice prefix: 1–6 letters/digits")
    .transform((s) => s.toUpperCase()),
  paymentTermsDays: intField(0, 120),
  invoiceFooter: optionalText,
  defaultCommissionBps: percentToBps,
  defaultMonthlyFeeCents: chfToCents,
});

export async function saveSettings(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = schema.safeParse(formToObject(formData));
  if (!parsed.success) return fail(firstError(parsed.error));
  const values = parsed.data;
  if (values.iban) {
    values.iban = values.iban.replace(/\s/g, "").toUpperCase();
    if (!isValidIban(values.iban)) return fail("The IBAN is not valid.");
  }
  await db
    .insert(platformSettings)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: platformSettings.id, set: values });
  await audit(admin.id, "settings.update");
  revalidatePath("/admin/settings");
  return ok("Settings saved");
}

export async function getSettingsRow() {
  await requireAdmin();
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.id, 1)).limit(1);
  return row ?? null;
}
