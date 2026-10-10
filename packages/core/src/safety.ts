/**
 * Deterministic safety guards that run on every caller utterance *before* the language model.
 *
 * Rule (business requirement): if a caller even remotely mentions allergies or intolerances, the
 * call is transferred to the restaurant staff. The bot never gives allergen advice. The detector is
 * intentionally conservative but understands negations such as "nein, keine Allergien" so that the
 * answer to our own allergy question does not trigger a transfer.
 */
import { normalize } from "./text";

/** Words that always indicate an allergy/intolerance topic (normalised, diacritics removed). */
const STRONG_PATTERNS: RegExp[] = [
  /\w*allerg\w*/, // Allergie, allergisch, Allergiker, Nussallergie, allergy
  /\w*unvertraglich\w*/, // Unverträglichkeit, Laktoseunverträglichkeit
  /\w*unvertreglich\w*/,
  /\w*intoleran\w*/, // Intoleranz, Laktoseintoleranz
  /\w*zoliak\w*/, // Zöliakie
  /\w*zoeliak\w*/,
  /\w*celiac\w*/,
  /\w*anaphyla\w*/,
  /\bepi ?pen\b/,
  /\bvertrag\w* (kei|nid|nod|ned|nicht|keine|keinen|kein)\b/, // "vertrag kei Nüss" / "verträgt keine"
  /\b(kei|keine|nid|nod|ned|nicht) vertrag\w*/,
  /\bdarf (kei|keine|kein|nid|nod|nicht)\w* (nuss|nuess|nusse|gluten|laktose|milch|ei|eier|fisch|sesam|soja|weizen)/,
];

/** Ingredient words that only count in a "free from / without" context. */
const INGREDIENTS =
  "(nuss|nusse|nuess|nuesse|nussli|erdnuss\\w*|haselnuss\\w*|baumnuss\\w*|mandel\\w*|cashew\\w*|pistazie\\w*|gluten\\w*|laktose\\w*|lactose\\w*|milchprodukt\\w*|sesam\\w*|soja\\w*|sellerie\\w*|senf\\w*|lupine\\w*|weizen\\w*|krustentier\\w*|schalentier\\w*|meeresfrucht\\w*|meeresfruechte|sulfit\\w*)";
const CONTEXT_PATTERNS: RegExp[] = [
  new RegExp(`\\b${INGREDIENTS}\\s?(frei|freie|freien|freis|freii)\\b`), // glutenfrei, laktose frei
  new RegExp(`\\b(ohne|ohni|kei|keine|keini|ohn)\\s+(\\w+\\s+)?${INGREDIENTS}\\b`), // ohne Nüsse, ohni Gluten
  new RegExp(`\\b${INGREDIENTS}\\b.*\\b(drin|drinn|dinne|enthalten|enthalt|dabei|druf|drauf)\\b`), // "het's Nüss drin?"
  new RegExp(`\\b${INGREDIENTS}\\b.*\\b(problem\\w*|schlimm|gfahrlich|gefahrlich|reagier\\w*|vertrag\\w*|vertreit)\\b`), // "Laktose isch es Problem"
];

/** Negated allergy statements that are a valid "no" to the allergy question. */
const NEGATION_PATTERNS: RegExp[] = [
  /\b(kei|keine|keini|keis|keni|kein|keinerlei|nid|nod|ned|nicht|nit|niid)\s+(\w+\s+)?(\w*allerg\w*|\w*unvertraglich\w*|\w*intoleran\w*)/g,
  /\b(\w*allerg\w*|\w*unvertraglich\w*|\w*intoleran\w*)\s+(\w+\s+)?(kei|keine|keini|nid|nod|ned|nicht|nit|niid|nei|nein|nope|no)\b/g,
  /\bniemer\s+(\w+\s+)?(het|hat|hed|isch|ist)\s+(\w+\s+)?(\w*allerg\w*|\w*unvertraglich\w*|\w*intoleran\w*)/g,
  /\bniemand\s+(\w+\s+)?(het|hat|hed|isch|ist)\s+(\w+\s+)?(\w*allerg\w*|\w*unvertraglich\w*|\w*intoleran\w*)/g,
  /\bno allerg\w*/g,
];

export type AllergyCheck = { mentioned: boolean; matched: string | null };

/**
 * Detects allergy/intolerance mentions. Negated statements ("keine Allergien", "niemer isch
 * allergisch") are ignored, everything else counts.
 */
export function detectAllergyMention(utterance: string): AllergyCheck {
  let text = ` ${normalize(utterance)} `;
  for (const neg of NEGATION_PATTERNS) {
    text = text.replace(neg, " ");
  }
  for (const p of STRONG_PATTERNS) {
    const m = p.exec(text);
    if (m) return { mentioned: true, matched: m[0] };
  }
  for (const p of CONTEXT_PATTERNS) {
    const m = p.exec(text);
    if (m) return { mentioned: true, matched: m[0] };
  }
  return { mentioned: false, matched: null };
}

/**
 * Detects explicit requests to talk to a human/the owner. The language model handles softer cases;
 * this is a deterministic backstop for unambiguous requests.
 */
export function detectHumanRequest(utterance: string): boolean {
  const t = ` ${normalize(utterance)} `;
  const person =
    "(chef|chefin|inhaber|inhaberin|besitzer|besitzerin|geschaftsfuhrer\\w*|geschaeftsfuehrer\\w*|mensch|menschen|mitarbeiter\\w*|personal|angestellte\\w*|echte person|richtige person|echten person|richtigen person|real person|human|owner|manager)";
  const verb =
    "(rede|reden|reda|sprechen|spreche|sprache|verbinde\\w*|verbunden|weiterleite\\w*|weiterverbinde\\w*|durchstelle\\w*|talk|speak)";
  const re1 = new RegExp(`\\b${person}\\b.*\\b${verb}\\b`);
  const re2 = new RegExp(`\\b${verb}\\b.*\\b${person}\\b`);
  const re3 = /\b(kein|keine|nid|nod|ned|nicht) (roboter|bot|maschine|computer|ki|ai)\b/;
  return re1.test(t) || re2.test(t) || re3.test(t);
}
