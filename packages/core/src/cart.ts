import { formatChf } from "./money";
import type { MenuIndex } from "./menu/menu-index";
import type { MenuItemSnap, OptionGroupSnap } from "./menu/types";

export type CartLineOption = {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceDeltaCents: number;
};

export type CartLine = {
  lineId: string;
  itemId: string;
  name: string;
  quantity: number;
  basePriceCents: number;
  options: CartLineOption[];
  notes: string | null;
};

export type AddItemInput = {
  item: string;
  quantity?: number;
  options?: string[];
  notes?: string | null;
};

/** Result for a single requested item. Messages are German, meant for the language model. */
export type AddItemResult =
  | { status: "added"; lineId: string; text: string; merged: boolean }
  | {
      status: "needs_choice";
      item: string;
      ref: string;
      missing: { group: string; min: number; max: number; choices: string[] }[];
      message: string;
    }
  | { status: "ambiguous"; query: string; candidates: string[]; message: string }
  | { status: "not_found"; query: string; suggestions: string[]; message: string }
  | { status: "unavailable"; item: string; message: string }
  | { status: "invalid_option"; item: string; option: string; available: string[]; message: string }
  | { status: "invalid_quantity"; item: string; message: string };

export class CartError extends Error {}

/** Line unit price = base + all option deltas. */
export function lineUnitPrice(line: Pick<CartLine, "basePriceCents" | "options">): number {
  return line.basePriceCents + line.options.reduce((acc, o) => acc + o.priceDeltaCents, 0);
}

export function lineTotal(line: CartLine): number {
  return lineUnitPrice(line) * line.quantity;
}

/** Human readable line without price: "2x Pizza Napoli (Gross, Extra Käse) – ohne Oliven". */
export function describeLine(line: CartLine): string {
  const opts = line.options.map((o) => o.optionName);
  let text = `${line.quantity}x ${line.name}`;
  if (opts.length) text += ` (${opts.join(", ")})`;
  if (line.notes) text += ` – ${line.notes}`;
  return text;
}

/**
 * Shopping cart with server-side pricing. The language model never computes prices – it only
 * reads the summaries produced here.
 */
export class Cart {
  private lines: CartLine[] = [];
  private nextLine = 1;
  /** Incremented on every change; used to make sure the caller confirmed the latest version. */
  version = 0;

  constructor(
    private readonly menu: MenuIndex,
    private readonly maxQuantity = 20,
  ) {}

  get items(): readonly CartLine[] {
    return this.lines;
  }

  get isEmpty(): boolean {
    return this.lines.length === 0;
  }

  get itemCount(): number {
    return this.lines.reduce((acc, l) => acc + l.quantity, 0);
  }

  get subtotalCents(): number {
    return this.lines.reduce((acc, l) => acc + lineTotal(l), 0);
  }

  getLine(lineId: string): CartLine | undefined {
    const id = lineId.trim().toUpperCase();
    return this.lines.find((l) => l.lineId === id);
  }

  add(input: AddItemInput): AddItemResult {
    const quantity = input.quantity ?? 1;
    const match = this.menu.matchItem(input.item);
    if (match.status === "none") {
      const suggestions = match.candidates.slice(0, 3).map((c) => c.item.name);
      return {
        status: "not_found",
        query: input.item,
        suggestions,
        message: suggestions.length
          ? `"${input.item}" ist nicht auf der Karte. Ähnlich: ${suggestions.join(", ")}.`
          : `"${input.item}" ist nicht auf der Karte.`,
      };
    }
    if (match.status === "ambiguous") {
      const candidates = match.candidates.map((c) => `${c.item.name} [${c.ref}]`);
      return {
        status: "ambiguous",
        query: input.item,
        candidates,
        message: `"${input.item}" ist nicht eindeutig. Frage nach, welches gemeint ist: ${match.candidates
          .map((c) => c.item.name)
          .join(", ")}.`,
      };
    }
    const item = match.item;
    if (!item.isAvailable) {
      return {
        status: "unavailable",
        item: item.name,
        message: `${item.name} ist heute leider ausverkauft. Biete eine Alternative an.`,
      };
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > this.maxQuantity) {
      return {
        status: "invalid_quantity",
        item: item.name,
        message: `Ungültige Menge ${quantity}. Erlaubt sind 1 bis ${this.maxQuantity} pro Position. Bei grösseren Bestellungen an das Personal verbinden.`,
      };
    }

    const resolved = this.resolveOptions(item, input.options ?? []);
    if ("error" in resolved) return resolved.error;
    const missing = this.missingRequired(item, resolved.options);
    if (missing.length) {
      return {
        status: "needs_choice",
        item: item.name,
        ref: match.ref,
        missing,
        message: `Für ${item.name} fehlt noch eine Auswahl: ${missing
          .map((m) => `${m.group} (${m.choices.join(", ")})`)
          .join("; ")}. Frage den Kunden und rufe add_items danach erneut mit der Option auf.`,
      };
    }

    const notes = input.notes?.trim() || null;
    const existing = this.lines.find(
      (l) =>
        l.itemId === item.id &&
        sameOptions(l.options, resolved.options) &&
        (l.notes ?? null) === notes,
    );
    if (existing) {
      if (existing.quantity + quantity > this.maxQuantity) {
        return {
          status: "invalid_quantity",
          item: item.name,
          message: `Maximal ${this.maxQuantity} Stück pro Position.`,
        };
      }
      existing.quantity += quantity;
      this.version += 1;
      return {
        status: "added",
        lineId: existing.lineId,
        text: describeLine(existing),
        merged: true,
      };
    }

    const line: CartLine = {
      lineId: `L${this.nextLine++}`,
      itemId: item.id,
      name: item.name,
      quantity,
      basePriceCents: item.priceCents,
      options: resolved.options,
      notes,
    };
    this.lines.push(line);
    this.version += 1;
    return { status: "added", lineId: line.lineId, text: describeLine(line), merged: false };
  }

  update(
    lineId: string,
    changes: { quantity?: number; options?: string[]; notes?: string | null },
  ): { ok: true; text: string; removed?: boolean } | { ok: false; message: string } {
    const line = this.getLine(lineId);
    if (!line) return { ok: false, message: `Position ${lineId} existiert nicht.` };
    if (changes.quantity !== undefined) {
      if (changes.quantity === 0) {
        this.remove(line.lineId);
        return { ok: true, text: `${line.name} entfernt`, removed: true };
      }
      if (
        !Number.isInteger(changes.quantity) ||
        changes.quantity < 1 ||
        changes.quantity > this.maxQuantity
      ) {
        return { ok: false, message: `Ungültige Menge. Erlaubt: 1 bis ${this.maxQuantity}.` };
      }
    }
    const item = this.menu.getItemById(line.itemId);
    let newOptions = line.options;
    if (changes.options) {
      if (!item) return { ok: false, message: "Artikel nicht mehr verfügbar." };
      const resolved = this.resolveOptions(item, changes.options, false);
      if ("error" in resolved) return { ok: false, message: resolved.error.message };
      // Merge: options from groups that were mentioned replace previous selections of those groups.
      const touchedGroups = new Set(resolved.options.map((o) => o.groupId));
      newOptions = [
        ...line.options.filter((o) => !touchedGroups.has(o.groupId)),
        ...resolved.options,
      ];
      const groups = this.menu.groupsForItem(item);
      for (const group of groups) {
        const count = newOptions.filter((o) => o.groupId === group.id).length;
        if (count > group.maxSelect) {
          return {
            ok: false,
            message: `Bei ${group.name} sind höchstens ${group.maxSelect} Optionen möglich.`,
          };
        }
      }
      const missing = this.missingRequired(item, newOptions);
      if (missing.length) {
        return {
          ok: false,
          message: `Es fehlt eine Auswahl: ${missing.map((m) => `${m.group} (${m.choices.join(", ")})`).join("; ")}`,
        };
      }
    }
    if (changes.quantity !== undefined) line.quantity = changes.quantity;
    line.options = sortOptions(newOptions, item ? this.menu.groupsForItem(item) : []);
    if (changes.notes !== undefined) line.notes = changes.notes?.trim() || null;
    this.version += 1;
    return { ok: true, text: describeLine(line) };
  }

  remove(lineId: string): boolean {
    const id = lineId.trim().toUpperCase();
    const before = this.lines.length;
    this.lines = this.lines.filter((l) => l.lineId !== id);
    if (this.lines.length !== before) {
      this.version += 1;
      return true;
    }
    return false;
  }

  clear() {
    if (this.lines.length) {
      this.lines = [];
      this.version += 1;
    }
  }

  /** Multi-line summary with prices, used for the state context and the final review. */
  summary({ withPrices = true } = {}): string {
    if (!this.lines.length) return "(leer)";
    return this.lines
      .map(
        (l) =>
          `${l.lineId}: ${describeLine(l)}${withPrices ? ` = ${formatChf(lineTotal(l))}` : ""}`,
      )
      .join("\n");
  }

  toJSON() {
    return {
      version: this.version,
      lines: this.lines.map((l) => ({
        ...l,
        unitPriceCents: lineUnitPrice(l),
        lineTotalCents: lineTotal(l),
      })),
      subtotalCents: this.subtotalCents,
    };
  }

  private resolveOptions(
    item: MenuItemSnap,
    requested: string[],
    applyDefaults = true,
  ): { options: CartLineOption[] } | { error: Exclude<AddItemResult, { status: "added" }> } {
    const groups = this.menu.groupsForItem(item);
    const selected: CartLineOption[] = [];
    for (const raw of requested) {
      if (!raw || !raw.trim()) continue;
      const match = this.menu.matchOption(item, raw);
      if (match.status !== "matched") {
        const available = groups.flatMap((g) =>
          g.options.filter((o) => o.isAvailable).map((o) => o.name),
        );
        return {
          error: {
            status: "invalid_option",
            item: item.name,
            option: raw,
            available,
            message:
              match.status === "ambiguous"
                ? `Option "${raw}" ist nicht eindeutig bei ${item.name}: ${match.candidates
                    .map((c) => `${c.group.name}: ${c.option.name}`)
                    .join(", ")}.`
                : available.length
                  ? `Option "${raw}" gibt es bei ${item.name} nicht. Verfügbar: ${available.join(", ")}. Wünsche wie "ohne Zwiebeln" als notes erfassen.`
                  : `${item.name} hat keine Optionen. Wünsche wie "ohne Zwiebeln" als notes erfassen.`,
          },
        };
      }
      if (!match.option.isAvailable) {
        return {
          error: {
            status: "invalid_option",
            item: item.name,
            option: raw,
            available: [],
            message: `${match.option.name} ist momentan nicht verfügbar.`,
          },
        };
      }
      if (selected.some((s) => s.optionId === match.option.id)) continue;
      selected.push({
        groupId: match.group.id,
        groupName: match.group.name,
        optionId: match.option.id,
        optionName: match.option.name,
        priceDeltaCents: match.option.priceDeltaCents,
      });
    }

    // Single-choice groups: the last mention wins ("klein … nein, gross").
    for (const group of groups) {
      const inGroup = selected.filter((s) => s.groupId === group.id);
      if (group.maxSelect === 1 && inGroup.length > 1) {
        const keep = inGroup[inGroup.length - 1]!;
        for (const s of inGroup) if (s !== keep) selected.splice(selected.indexOf(s), 1);
      } else if (inGroup.length > group.maxSelect) {
        return {
          error: {
            status: "invalid_option",
            item: item.name,
            option: inGroup.map((s) => s.optionName).join(", "),
            available: [],
            message: `Bei ${group.name} sind höchstens ${group.maxSelect} Optionen möglich.`,
          },
        };
      }
    }

    // Apply defaults for required groups that the caller did not mention.
    for (const group of groups) {
      if (!applyDefaults || group.minSelect < 1) continue;
      if (selected.some((s) => s.groupId === group.id)) continue;
      const defaults = group.options.filter((o) => o.isDefault && o.isAvailable);
      if (defaults.length >= group.minSelect) {
        for (const d of defaults.slice(0, Math.max(group.minSelect, 1))) {
          selected.push({
            groupId: group.id,
            groupName: group.name,
            optionId: d.id,
            optionName: d.name,
            priceDeltaCents: d.priceDeltaCents,
          });
        }
      }
    }
    return { options: sortOptions(selected, groups) };
  }

  private missingRequired(item: MenuItemSnap, selected: CartLineOption[]) {
    return this.menu
      .groupsForItem(item)
      .filter(
        (g) => g.minSelect > 0 && selected.filter((s) => s.groupId === g.id).length < g.minSelect,
      )
      .map((g) => ({
        group: g.name,
        min: g.minSelect,
        max: g.maxSelect,
        choices: g.options
          .filter((o) => o.isAvailable)
          .map((o) =>
            o.priceDeltaCents ? `${o.name} (+${formatChf(o.priceDeltaCents)})` : o.name,
          ),
      }));
  }
}

function sameOptions(a: CartLineOption[], b: CartLineOption[]): boolean {
  if (a.length !== b.length) return false;
  const ids = new Set(a.map((o) => o.optionId));
  return b.every((o) => ids.has(o.optionId));
}

function sortOptions(options: CartLineOption[], groups: OptionGroupSnap[]): CartLineOption[] {
  const order = new Map(groups.map((g, i) => [g.id, i]));
  return [...options].sort((a, b) => (order.get(a.groupId) ?? 99) - (order.get(b.groupId) ?? 99));
}
