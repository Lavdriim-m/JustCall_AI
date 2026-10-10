import "server-only";
import { z } from "zod";

export type ActionResult =
  { ok?: boolean; error?: string; message?: string; data?: unknown } | undefined;

/** Converts checkbox/empty-string semantics of HTML forms for zod parsing. */
export function formToObject(formData: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$ACTION")) continue;
    if (key.endsWith("[]")) {
      const k = key.slice(0, -2);
      (obj[k] as unknown[] | undefined) ? (obj[k] as unknown[]).push(value) : (obj[k] = [value]);
    } else obj[key] = value;
  }
  return obj;
}

export const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());
export const optionalText = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : typeof v === "string" ? v.trim() : v),
  z.string().max(5000).nullable().optional(),
);
export const chfToCents = z.preprocess((v) => {
  if (typeof v !== "string" && typeof v !== "number") return v;
  const s = String(v)
    .replace(/[’' ]/g, "")
    .replace(",", ".")
    .replace(/[.,]-+$/, "")
    .trim();
  if (s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : v;
}, z.number().int().min(0).max(100_000_00));
export const percentToBps = z.preprocess((v) => {
  const s = String(v ?? "")
    .replace(",", ".")
    .replace("%", "")
    .trim();
  if (s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : v;
}, z.number().int().min(0).max(10_000));
export const intField = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : Number(v)),
    z.number().int().min(min).max(max),
  );

export function firstError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid input";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

export function ok(message = "Saved", data?: unknown): ActionResult {
  return { ok: true, message, data };
}

export function fail(error: string): ActionResult {
  return { error };
}
