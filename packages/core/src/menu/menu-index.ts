import { normalize, tokenize, tokenSimilarity } from "../text";
import type { MenuItemSnap, MenuOptionSnap, MenuSnapshot, OptionGroupSnap } from "./types";

export type ItemCandidate = { item: MenuItemSnap; ref: string; score: number; matchedName: string };

export type ItemMatch =
  | { status: "exact" | "confident"; item: MenuItemSnap; ref: string; candidates: ItemCandidate[] }
  | { status: "ambiguous"; candidates: ItemCandidate[] }
  | { status: "none"; candidates: ItemCandidate[] };

export type OptionMatch =
  | { status: "matched"; option: MenuOptionSnap; group: OptionGroupSnap; ref: string }
  | { status: "ambiguous"; candidates: { option: MenuOptionSnap; group: OptionGroupSnap }[] }
  | { status: "none" };

const CODE_PREFIX = /^(?:nummer|nr|no|num|menu|menue|meni|combo|kombo|kombi)\s+/;

type IndexedName = { text: string; tokens: string[]; normalized: string };

/**
 * Searchable index over a menu snapshot.
 *
 * Every item and option receives a short, stable reference ("I3", "O12") that is shown to the
 * language model instead of UUIDs. Item lookups accept references, codes ("Nummer 3"), names and
 * any number of aliases ("Combo 3" = "Pizza Napoli"), with typo tolerance for speech transcripts.
 */
export class MenuIndex {
  readonly snapshot: MenuSnapshot;
  readonly items: MenuItemSnap[];
  private readonly itemRefs = new Map<string, MenuItemSnap>();
  private readonly refByItemId = new Map<string, string>();
  private readonly optionRefs = new Map<string, { option: MenuOptionSnap; group: OptionGroupSnap }>();
  private readonly refByOptionId = new Map<string, string>();
  private readonly groups = new Map<string, OptionGroupSnap>();
  private readonly names = new Map<string, IndexedName[]>();
  private readonly codes = new Map<string, MenuItemSnap>();
  private readonly idf = new Map<string, number>();
  private readonly maxIdf: number;

  constructor(snapshot: MenuSnapshot) {
    this.snapshot = snapshot;
    const categoryOrder = new Map(
      [...snapshot.categories]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c, i) => [c.id, i] as const),
    );
    this.items = [...snapshot.items].sort((a, b) => {
      const ca = a.categoryId ? (categoryOrder.get(a.categoryId) ?? 999) : 999;
      const cb = b.categoryId ? (categoryOrder.get(b.categoryId) ?? 999) : 999;
      return ca - cb || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
    });
    this.items.forEach((item, i) => {
      const ref = `I${i + 1}`;
      this.itemRefs.set(ref.toLowerCase(), item);
      this.refByItemId.set(item.id, ref);
      if (item.code) this.codes.set(normalize(item.code), item);
    });
    let optionCounter = 0;
    for (const group of [...snapshot.groups].sort((a, b) => a.sortOrder - b.sortOrder)) {
      this.groups.set(group.id, group);
      for (const option of [...group.options].sort((a, b) => a.sortOrder - b.sortOrder)) {
        optionCounter += 1;
        const ref = `O${optionCounter}`;
        this.optionRefs.set(ref.toLowerCase(), { option, group });
        this.refByOptionId.set(option.id, ref);
      }
    }

    // Build name index and document frequencies.
    const df = new Map<string, number>();
    for (const item of this.items) {
      const variants = uniqueStrings([item.name, ...item.aliases]);
      const indexed = variants
        .map((text) => ({
          text,
          normalized: normalize(text),
          tokens: tokenize(text, { dropStopwords: true }),
        }))
        .filter((n) => n.tokens.length > 0);
      this.names.set(item.id, indexed);
      const seen = new Set(indexed.flatMap((n) => n.tokens));
      for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
    }
    const n = Math.max(this.items.length, 1);
    for (const [t, count] of df) this.idf.set(t, Math.log(1 + n / count));
    this.maxIdf = Math.log(1 + n);
  }

  refForItem(itemId: string): string {
    return this.refByItemId.get(itemId) ?? itemId;
  }

  refForOption(optionId: string): string {
    return this.refByOptionId.get(optionId) ?? optionId;
  }

  getItemById(id: string): MenuItemSnap | undefined {
    return this.items.find((i) => i.id === id);
  }

  getGroup(id: string): OptionGroupSnap | undefined {
    return this.groups.get(id);
  }

  groupsForItem(item: MenuItemSnap): OptionGroupSnap[] {
    return item.groupIds.map((id) => this.groups.get(id)).filter((g): g is OptionGroupSnap => !!g);
  }

  categoryName(categoryId: string | null): string | null {
    if (!categoryId) return null;
    return this.snapshot.categories.find((c) => c.id === categoryId)?.name ?? null;
  }

  private weight(token: string): number {
    return this.idf.get(token) ?? this.maxIdf;
  }

  private score(query: string[], name: string[]): number {
    if (!query.length || !name.length) return 0;
    let nameWeight = 0;
    let nameCovered = 0;
    for (const t of name) {
      const w = this.weight(t);
      nameWeight += w;
      nameCovered += w * Math.max(...query.map((q) => tokenSimilarity(t, q)));
    }
    let queryWeight = 0;
    let queryCovered = 0;
    for (const q of query) {
      const w = this.weight(q);
      queryWeight += w;
      queryCovered += w * Math.max(...name.map((t) => tokenSimilarity(q, t)));
    }
    const recall = nameCovered / nameWeight;
    const precision = queryCovered / queryWeight;
    if (recall === 0 || precision === 0) return 0;
    // Recall-weighted F-score (beta = 2): callers often add extra words ("die grossi Napoli").
    return (5 * precision * recall) / (4 * precision + recall);
  }

  /** Resolves a free-text or reference item mention to a menu item. */
  matchItem(query: string): ItemMatch {
    const raw = query.trim();
    const byRef = this.itemRefs.get(raw.toLowerCase());
    if (byRef) {
      const ref = this.refForItem(byRef.id);
      return { status: "exact", item: byRef, ref, candidates: [{ item: byRef, ref, score: 1, matchedName: byRef.name }] };
    }
    const byId = this.items.find((i) => i.id === raw);
    if (byId) {
      const ref = this.refForItem(byId.id);
      return { status: "exact", item: byId, ref, candidates: [{ item: byId, ref, score: 1, matchedName: byId.name }] };
    }

    const normalized = normalize(raw);
    const numericQuery = tokenize(raw).join(" ");
    // Menu codes: "3", "Nummer 3", "Menü drü"
    const codeQuery = numericQuery.replace(CODE_PREFIX, "").trim();
    const codeHit = this.codes.get(codeQuery) ?? this.codes.get(normalized);
    if (codeHit && (CODE_PREFIX.test(numericQuery) || /^\w{1,4}$/.test(codeQuery))) {
      const ref = this.refForItem(codeHit.id);
      return { status: "exact", item: codeHit, ref, candidates: [{ item: codeHit, ref, score: 1, matchedName: codeHit.code ?? codeHit.name }] };
    }

    // Exact name/alias match (normalised)
    for (const item of this.items) {
      const names = this.names.get(item.id) ?? [];
      const hit = names.find((n) => n.normalized === normalized || n.tokens.join(" ") === numericQuery);
      if (hit) {
        const ref = this.refForItem(item.id);
        return { status: "exact", item, ref, candidates: [{ item, ref, score: 1, matchedName: hit.text }] };
      }
    }

    const queryTokens = tokenize(raw, { dropStopwords: true });
    const candidates: ItemCandidate[] = [];
    for (const item of this.items) {
      let best = 0;
      let bestName = item.name;
      for (const n of this.names.get(item.id) ?? []) {
        const s = this.score(queryTokens, n.tokens);
        if (s > best) {
          best = s;
          bestName = n.text;
        }
      }
      if (best > 0) candidates.push({ item, ref: this.refForItem(item.id), score: best, matchedName: bestName });
    }
    candidates.sort((a, b) => b.score - a.score);
    const top = candidates.slice(0, 5);
    const first = top[0];
    const second = top[1];
    if (!first || first.score < 0.45) return { status: "none", candidates: top.filter((c) => c.score >= 0.3) };
    const margin = first.score - (second?.score ?? 0);
    if (first.score >= 0.72 && (margin >= 0.12 || (second?.score ?? 0) < 0.5)) {
      return { status: "confident", item: first.item, ref: first.ref, candidates: top };
    }
    return { status: "ambiguous", candidates: top.filter((c) => c.score >= first.score - 0.2) };
  }

  /** Resolves an option mention ("gross", "O4", "extra Käse") within the groups of an item. */
  matchOption(item: MenuItemSnap, query: string): OptionMatch {
    const raw = query.trim();
    const groups = this.groupsForItem(item);
    const byRef = this.optionRefs.get(raw.toLowerCase());
    if (byRef && groups.some((g) => g.id === byRef.group.id)) {
      return { status: "matched", option: byRef.option, group: byRef.group, ref: this.refForOption(byRef.option.id) };
    }
    const all = groups.flatMap((group) => group.options.map((option) => ({ option, group })));
    const byId = all.find((o) => o.option.id === raw);
    if (byId) return { status: "matched", ...byId, ref: this.refForOption(byId.option.id) };

    const normalized = normalize(raw);
    const exact = all.filter(({ option }) =>
      [option.name, ...option.aliases].some((n) => normalize(n) === normalized),
    );
    if (exact.length === 1) {
      const hit = exact[0]!;
      return { status: "matched", ...hit, ref: this.refForOption(hit.option.id) };
    }
    if (exact.length > 1) return { status: "ambiguous", candidates: exact };

    const q = tokenize(raw, { dropStopwords: true });
    if (!q.length) return { status: "none" };
    const scored = all
      .map((entry) => {
        let best = 0;
        for (const n of [entry.option.name, ...entry.option.aliases]) {
          const t = tokenize(n, { dropStopwords: true });
          best = Math.max(best, fScore(q, t));
        }
        return { ...entry, score: best };
      })
      .filter((s) => s.score >= 0.6)
      .sort((a, b) => b.score - a.score);
    const first = scored[0];
    if (!first) return { status: "none" };
    const second = scored[1];
    if (!second || first.score - second.score >= 0.15) {
      return { status: "matched", option: first.option, group: first.group, ref: this.refForOption(first.option.id) };
    }
    return { status: "ambiguous", candidates: scored.slice(0, 4) };
  }

  /** Free-text menu search for questions such as "Was für vegetarische Pizzas habt ihr?". */
  search(query: string, limit = 8): MenuItemSnap[] {
    const q = tokenize(query, { dropStopwords: true });
    if (!q.length) return [];
    const scored = this.items.map((item) => {
      const haystack = tokenize(
        [item.name, ...item.aliases, item.description ?? "", ...item.tags, this.categoryName(item.categoryId) ?? ""].join(" "),
        { dropStopwords: true },
      );
      let hits = 0;
      for (const t of q) {
        if (haystack.some((h) => tokenSimilarity(t, h) >= 0.8)) hits += 1;
      }
      return { item, score: hits / q.length };
    });
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.item);
  }
}

function fScore(query: string[], name: string[]): number {
  if (!query.length || !name.length) return 0;
  const recall = name.reduce((acc, t) => acc + Math.max(...query.map((q) => tokenSimilarity(t, q))), 0) / name.length;
  const precision = query.reduce((acc, q) => acc + Math.max(...name.map((t) => tokenSimilarity(q, t))), 0) / query.length;
  if (!recall || !precision) return 0;
  return (2 * precision * recall) / (precision + recall);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const trimmed = v?.trim();
    if (!trimmed) continue;
    const key = normalize(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}
