"use server";

import OpenAI from "openai";
import { z } from "zod";
import { requireRestaurantAccess } from "../session";
import { fail, type ActionResult } from "./helpers";

const aiMenuSchema = z.object({
  categories: z.array(
    z.object({
      name: z.string(),
      items: z.array(
        z.object({
          name: z.string(),
          description: z.string().nullable().optional(),
          code: z.string().nullable().optional(),
          price: z.union([z.number(), z.string()]),
          aliases: z.array(z.string()).optional(),
          tags: z.array(z.string()).optional(),
          optionGroups: z.array(z.string()).optional(),
        }),
      ),
    }),
  ),
  optionGroups: z
    .array(
      z.object({
        name: z.string(),
        minSelect: z.number().int().min(0),
        maxSelect: z.number().int().min(1),
        options: z.array(
          z.object({
            name: z.string(),
            priceDelta: z.union([z.number(), z.string()]).optional(),
            aliases: z.array(z.string()).optional(),
            isDefault: z.boolean().optional(),
          }),
        ),
      }),
    )
    .optional(),
});

const SYSTEM = `Du wandelst Speisekarten von Schweizer Restaurants in strukturiertes JSON um.
Gib NUR JSON in diesem Format zurück:
{"categories":[{"name":"Pizza","items":[{"name":"Pizza Napoli","description":"Tomaten, Mozzarella, Sardellen","code":"3","price":18.5,"aliases":["Napoli","Nummer 3"],"tags":["scharf"],"optionGroups":["Grösse"]}]}],
 "optionGroups":[{"name":"Grösse","minSelect":1,"maxSelect":1,"options":[{"name":"Normal","priceDelta":0,"isDefault":true},{"name":"Gross","priceDelta":5,"aliases":["Family"]}]}]}
Regeln:
- Preise als Zahl in CHF (18.50 → 18.5). Aufpreise als priceDelta.
- Übernimm Nummern auf der Karte als "code" (z. B. "12" oder "M3").
- Schlage für jeden Artikel 1–4 sinnvolle "aliases" vor, wie Gäste am Telefon bestellen würden (Kurzformen, Schweizerdeutsche Varianten, "Menü 3", ohne Duplikate des Namens).
- Varianten wie Grössen, Saucen, Beilagen-Wahl oder Extras werden Optionsgruppen (minSelect 1 = Pflichtauswahl). Gleiche Gruppen nur einmal definieren und per Name referenzieren.
- tags nur aus: vegetarisch, vegan, scharf, neu, beliebt.
- Erfinde nichts, was nicht auf der Karte steht. Schweizer Rechtschreibung (ss statt ß).`;

function toCents(v: number | string | undefined): number {
  if (v === undefined) return 0;
  const n =
    typeof v === "number"
      ? v
      : Number(
          String(v)
            .replace(/[^\d.,-]/g, "")
            .replace(",", "."),
        );
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * Converts pasted menu text or a photo of a menu into the import format using an OpenAI model.
 * Returns the parsed menu for review – nothing is saved until the user confirms the import.
 */
export async function parseMenuWithAi(
  restaurantId: string,
  input: { text?: string; imageDataUrl?: string },
): Promise<ActionResult> {
  await requireRestaurantAccess(restaurantId, "owner");
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.length < 20)
    return fail("OPENAI_API_KEY is not configured – AI import is unavailable.");
  if (!input.text?.trim() && !input.imageDataUrl)
    return fail("Paste the menu text or upload a photo.");
  if (input.imageDataUrl && input.imageDataUrl.length > 8_000_000)
    return fail("Image too large (max ~6 MB).");

  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    timeout: 120_000,
  });
  const model = process.env.OPENAI_MENU_MODEL || process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
  if (input.text?.trim())
    content.push({ type: "text", text: `Speisekarte:\n${input.text.slice(0, 40_000)}` });
  if (input.imageDataUrl) {
    content.push({ type: "text", text: "Lies die Speisekarte auf diesem Foto." });
    content.push({ type: "image_url", image_url: { url: input.imageDataUrl } });
  }
  try {
    const res = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content },
      ],
      response_format: { type: "json_object" },
    });
    const raw = res.choices[0]?.message?.content ?? "";
    const parsed = aiMenuSchema.safeParse(JSON.parse(raw));
    if (!parsed.success)
      return fail(
        "The model returned an unexpected format. Please try again or simplify the input.",
      );
    const menu = {
      categories: parsed.data.categories.map((c) => ({
        name: c.name,
        items: c.items.map((i) => ({
          name: i.name,
          description: i.description ?? null,
          code: i.code ?? null,
          priceCents: toCents(i.price),
          aliases: i.aliases ?? [],
          tags: i.tags ?? [],
          optionGroups: i.optionGroups ?? [],
        })),
      })),
      optionGroups: (parsed.data.optionGroups ?? []).map((g) => ({
        name: g.name,
        minSelect: g.minSelect,
        maxSelect: Math.max(g.maxSelect, g.minSelect, 1),
        options: g.options.map((o) => ({
          name: o.name,
          priceDeltaCents: toCents(o.priceDelta),
          aliases: o.aliases ?? [],
          isDefault: o.isDefault ?? false,
        })),
      })),
    };
    return { ok: true, message: "Menu recognised – please review before importing", data: menu };
  } catch (err) {
    return fail(`AI import failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
