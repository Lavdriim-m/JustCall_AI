/** Menu import format shared by CSV, JSON and AI imports. */
export type ImportedMenu = {
  categories: {
    name: string;
    items: {
      name: string;
      priceCents: number;
      code?: string | null;
      aliases?: string[];
      description?: string | null;
      optionGroups?: string[];
      tags?: string[];
    }[];
  }[];
  optionGroups?: {
    name: string;
    minSelect: number;
    maxSelect: number;
    options: { name: string; priceDeltaCents?: number; aliases?: string[]; isDefault?: boolean }[];
  }[];
};

/** CSV columns: category,name,price,code,aliases,description,options (aliases/options separated by |). */
export function parseMenuCsv(text: string): ImportedMenu {
  const rows = parseCsv(text.trim());
  const header = rows.shift()?.map((h) => h.trim().toLowerCase()) ?? [];
  const col = (name: string) => header.indexOf(name);
  const required = ["category", "name", "price"];
  for (const r of required)
    if (col(r) < 0)
      throw new Error(
        `Missing column "${r}". Expected: category,name,price,code,aliases,description,options`,
      );
  const categories = new Map<string, ImportedMenu["categories"][number]>();
  for (const row of rows) {
    if (!row.some((c) => c.trim())) continue;
    const get = (name: string) => (col(name) >= 0 ? (row[col(name)] ?? "").trim() : "");
    const catName = get("category") || "Weitere";
    const price = Number(
      get("price")
        .replace(/[^\d.,-]/g, "")
        .replace(",", "."),
    );
    if (!get("name") || !Number.isFinite(price)) throw new Error(`Invalid row: ${row.join(",")}`);
    if (!categories.has(catName)) categories.set(catName, { name: catName, items: [] });
    categories.get(catName)!.items.push({
      name: get("name"),
      priceCents: Math.round(price * 100),
      code: get("code") || null,
      aliases: get("aliases")
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean),
      description: get("description") || null,
      optionGroups: get("options")
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean),
    });
  }
  return { categories: [...categories.values()] };
}

function parseCsv(text: string): string[][] {
  const delimiter =
    text.split("\n")[0]!.includes(";") && !text.split("\n")[0]!.includes(",") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}
