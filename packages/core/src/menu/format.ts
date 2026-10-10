import { formatChf } from "../money";
import type { MenuIndex } from "./menu-index";

function delta(cents: number): string {
  if (cents === 0) return "";
  return cents > 0
    ? ` +${formatChf(cents, { withCurrency: false })}`
    : ` ${formatChf(cents, { withCurrency: false })}`;
}

/**
 * Compact, model-friendly menu listing. Option groups are listed once and referenced by items to
 * keep the prompt small (and cache friendly) even for large menus.
 */
export function formatMenuForPrompt(index: MenuIndex): string {
  const { snapshot } = index;
  const lines: string[] = [];
  const groups = [...snapshot.groups].sort((a, b) => a.sortOrder - b.sortOrder);
  const groupRef = new Map(groups.map((g, i) => [g.id, `G${i + 1}`]));
  const usedGroups = new Set(index.items.flatMap((i) => i.groupIds));

  if (groups.some((g) => usedGroups.has(g.id))) {
    lines.push("## Optionsgruppen");
    for (const g of groups) {
      if (!usedGroups.has(g.id)) continue;
      const rule =
        g.minSelect > 0
          ? g.minSelect === g.maxSelect
            ? `Pflicht, genau ${g.minSelect}`
            : `Pflicht, ${g.minSelect} bis ${g.maxSelect}`
          : g.maxSelect === 1
            ? "optional, max. 1"
            : `optional, max. ${g.maxSelect}`;
      const opts = [...g.options]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(
          (o) =>
            `${o.name} [${index.refForOption(o.id)}]${delta(o.priceDeltaCents)}${o.isDefault ? " (Standard)" : ""}${
              o.isAvailable ? "" : " (NICHT VERFÜGBAR)"
            }${o.aliases.length ? ` (auch: ${o.aliases.join(", ")})` : ""}`,
        );
      lines.push(`${groupRef.get(g.id)} ${g.name} (${rule}): ${opts.join(", ")}`);
    }
    lines.push("");
  }

  lines.push("## Speisekarte (Preise in CHF)");
  let currentCategory: string | null | undefined;
  for (const item of index.items) {
    const category = index.categoryName(item.categoryId) ?? "Weitere";
    if (category !== currentCategory) {
      lines.push(`### ${category}`);
      currentCategory = category;
    }
    const parts = [
      `- [${index.refForItem(item.id)}] ${item.name}`,
      formatChf(item.priceCents, { withCurrency: false }),
    ];
    const aka = [...item.aliases];
    if (item.code) aka.push(`Nummer ${item.code}`);
    if (aka.length) parts.push(`auch genannt: ${aka.join(", ")}`);
    if (item.description) parts.push(item.description);
    if (item.tags.length) parts.push(item.tags.join(", "));
    if (item.groupIds.length)
      parts.push(
        `Optionen: ${item.groupIds
          .map((g) => groupRef.get(g))
          .filter(Boolean)
          .join(", ")}`,
      );
    if (!item.isAvailable) parts.push("HEUTE AUSVERKAUFT");
    lines.push(parts.join(" | "));
  }
  return lines.join("\n");
}
