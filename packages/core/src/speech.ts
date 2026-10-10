/**
 * Prepares assistant text for text-to-speech: prices, times, multiplication signs, abbreviations
 * and stray formatting are rewritten so that any TTS engine pronounces them naturally in German.
 */

const ABBREVIATIONS: [RegExp, string][] = [
  [/\bz\.\s?B\./gi, "zum Beispiel"],
  [/\bca\./gi, "circa"],
  [/\bbzw\./gi, "beziehungsweise"],
  [/\binkl\./gi, "inklusive"],
  [/\bexkl\./gi, "exklusive"],
  [/\bevtl\./gi, "eventuell"],
  [/\bNr\./g, "Nummer"],
  [/\bMin\./g, "Minuten"],
  [/\bStk\./gi, "Stück"],
  [/\bu\.\s?a\./gi, "unter anderem"],
  [/\busw\./gi, "und so weiter"],
  [/\bdl\b/g, "Deziliter"],
  [/\bcl\b/g, "Zentiliter"],
  [/(\d)\s?l\b/g, "$1 Liter"],
  [/(\d)\s?g\b/g, "$1 Gramm"],
  [/(\d)\s?cm\b/g, "$1 Zentimeter"],
];

function spokenAmount(francs: string, rappen?: string): string {
  const f = Number(francs.replace(/['’]/g, ""));
  const r = rappen ? Number(rappen.padEnd(2, "0")) : 0;
  if (r === 0) return `${f} Franken`;
  if (f === 0) return `${r} Rappen`;
  return `${f} Franken ${r}`;
}

export function normalizeForSpeech(input: string): string {
  let t = input;
  // Remove markdown / list formatting the model might produce.
  t = t.replace(/\*\*|__|`|#+\s/g, "");
  t = t.replace(/^\s*[-•*]\s+/gm, "");
  // Internal references must never be read aloud.
  t = t.replace(/\s*\[(?:[IOL]\d+)\]/g, "");
  t = t.replace(/\((?:[IOL]\d+)\)/g, "");
  // Prices: "CHF 18.50", "18.50 CHF", "Fr. 18.–", "18.- Fr."
  t = t.replace(
    /\b(?:CHF|SFr\.?|Fr\.)\s?(\d{1,3}(?:['’]\d{3})*|\d+)(?:[.,](\d{1,2}|–|-{1,2}))?/g,
    (_m, f: string, r?: string) => spokenAmount(f, r && /\d/.test(r) ? r : undefined),
  );
  t = t.replace(
    /\b(\d{1,3}(?:['’]\d{3})*|\d+)(?:[.,](\d{2}|–|-{1,2}))?\s?(?:CHF|Franken|Fr\.)(?!\s?\d)/g,
    (_m, f: string, r?: string) => spokenAmount(f, r && /\d/.test(r) ? r : undefined),
  );
  // "+2.00" option surcharges
  t = t.replace(
    /\+\s?(\d+)[.,](\d{2})\b/g,
    (_m, f: string, r: string) => `plus ${spokenAmount(f, r)}`,
  );
  // Times "18:30" → "18 Uhr 30", "18:00" → "18 Uhr"
  t = t.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\s?(?:Uhr)?\b/g, (_m, h: string, m: string) =>
    m === "00" ? `${Number(h)} Uhr` : `${Number(h)} Uhr ${Number(m)}`,
  );
  // Quantities "2x Pizza", "2 x Pizza", "2× Pizza"
  t = t.replace(/\b(\d+)\s?[x×]\s/gi, "$1 mal ");
  for (const [re, rep] of ABBREVIATIONS) t = t.replace(re, rep);
  // Separators that TTS would read literally
  t = t.replace(/\s[–—-]\s/g, ", ");
  t = t.replace(/[;|]/g, ",");
  t = t.replace(/\s{2,}/g, " ").trim();
  return t;
}
