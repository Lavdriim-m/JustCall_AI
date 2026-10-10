/**
 * Text normalisation and fuzzy matching helpers tuned for (Swiss) German speech transcripts.
 */

/** Swiss German and Standard German number words → digits (used for menu codes like "Menü drü"). */
const NUMBER_WORDS: Record<string, string> = {
  null: "0",
  eins: "1",
  zwei: "2",
  zwoi: "2",
  zwo: "2",
  zwai: "2",
  drei: "3",
  dru: "3",
  drue: "3",
  vier: "4",
  vieri: "4",
  funf: "5",
  fuenf: "5",
  fuf: "5",
  fuef: "5",
  sechs: "6",
  sachs: "6",
  saechs: "6",
  sieben: "7",
  sibe: "7",
  siebe: "7",
  acht: "8",
  achti: "8",
  neun: "9",
  nun: "9",
  nuen: "9",
  zehn: "10",
  zah: "10",
  zaeh: "10",
  zeh: "10",
  elf: "11",
  olf: "11",
  oelf: "11",
  zwolf: "12",
  zwoelf: "12",
  zwolfi: "12",
};

/** Words that never help to identify a menu item. */
const STOPWORDS = new Set([
  "a",
  "e",
  "en",
  "es",
  "ein",
  "eine",
  "einen",
  "einer",
  "eis",
  "der",
  "die",
  "das",
  "dem",
  "den",
  "de",
  "d",
  "s",
  "mit",
  "mitem",
  "und",
  "oder",
  "bitte",
  "gern",
  "gerne",
  "gärn",
  "garn",
  "mal",
  "mol",
  "noch",
  "no",
  "nomal",
  "dann",
  "denn",
  "ich",
  "i",
  "mir",
  "hatt",
  "hett",
  "hatte",
  "hätte",
  "hett",
  "möchte",
  "mochte",
  "mochti",
  "wott",
  "will",
  "nimm",
  "nehme",
  "nimme",
  "bestellen",
  "bstelle",
  "so",
  "also",
  "äh",
  "ah",
  "eh",
  "ehm",
  "ja",
  "jo",
  "stuck",
  "stück",
  "x",
  "mal",
  "nummer",
  "nr",
]);

/** Lower-cases, removes diacritics (ä→a, ß→ss), punctuation and duplicate whitespace. */
export function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’'`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Normalised tokens with number words mapped to digits. */
export function tokenize(input: string, { dropStopwords = false } = {}): string[] {
  const tokens = normalize(input)
    .split(" ")
    .filter(Boolean)
    .map((t) => NUMBER_WORDS[t] ?? t);
  return dropStopwords ? tokens.filter((t) => !STOPWORDS.has(t)) : tokens;
}

export function isStopword(token: string): boolean {
  return STOPWORDS.has(token);
}

/** Classic Levenshtein edit distance. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

/** Similarity in [0,1] based on edit distance. */
export function stringSimilarity(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

/**
 * Similarity of two single tokens, tolerant to typical transcription errors
 * ("margarita" ~ "margherita", "doener" ~ "doner") but strict for short tokens and numbers.
 */
export function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum || bNum) return 0;
  // Compound words: "kebabteller" vs "kebab"
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) {
    return 0.85 * (Math.min(a.length, b.length) / Math.max(a.length, b.length)) + 0.15;
  }
  if (a.length < 4 || b.length < 4) return 0;
  // Phonetic-ish simplifications common in German transcripts.
  const simplify = (s: string) =>
    s
      .replace(/ph/g, "f")
      .replace(/th/g, "t")
      .replace(/gh/g, "g")
      .replace(/ck/g, "k")
      .replace(/c/g, "k")
      .replace(/z/g, "s")
      .replace(/y/g, "i")
      .replace(/ie/g, "i")
      .replace(/(.)\1+/g, "$1")
      .replace(/e(?=[aou])/g, "");
  const sa = simplify(a);
  const sb = simplify(b);
  if (sa === sb) return 0.95;
  const sim = stringSimilarity(sa, sb);
  const longest = Math.max(sa.length, sb.length);
  const threshold = longest <= 4 ? 1 : longest <= 6 ? 0.8 : 0.7;
  return sim >= threshold ? sim : 0;
}

/** Splits text into sentence-sized chunks suitable for incremental speech synthesis. */
export function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?…]+(?:[.!?…]+|$)/g) ?? [];
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * Incrementally extracts complete sentences from a stream of text deltas.
 * Returns the completed sentences and keeps the remainder buffered.
 */
export class SentenceStream {
  private buffer = "";

  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    // A sentence ends with . ! ? or … followed by whitespace. Avoid splitting on decimals ("18.50")
    // and common abbreviations.
    const re = /([.!?…]+)(\s+)/g;
    let match: RegExpExecArray | null;
    let lastIndex = 0;
    while ((match = re.exec(this.buffer))) {
      const end = match.index + match[1]!.length;
      const candidate = this.buffer.slice(lastIndex, end).trim();
      const prevWord = /(\S+)$/.exec(this.buffer.slice(lastIndex, match.index))?.[1] ?? "";
      if (/^(ca|bzw|z\.b|nr|fr|evtl|inkl|z\.?\s?b|u\.a|usw|etc|min|std|st)$/i.test(prevWord)) {
        continue;
      }
      if (candidate.length < 2) continue;
      out.push(candidate);
      lastIndex = match.index + match[0].length;
    }
    this.buffer = this.buffer.slice(lastIndex);
    return out;
  }

  flush(): string | null {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest.length ? rest : null;
  }
}

/** Creates a URL-friendly slug ("Pizzeria Ländli" → "pizzeria-landli"). */
export function slugify(input: string): string {
  return normalize(input).replace(/\s+/g, "-").slice(0, 60) || "restaurant";
}
