export type EditorOption = {
  id: string;
  name: string;
  aliases: string[];
  priceDeltaCents: number;
  isDefault: boolean;
  isAvailable: boolean;
  sortOrder: number;
};

export type EditorGroup = {
  id: string;
  name: string;
  description: string | null;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  options: EditorOption[];
};

export type EditorItem = {
  id: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  code: string | null;
  aliases: string[];
  priceCents: number;
  tags: string[];
  allergens: string[];
  isAvailable: boolean;
  isActive: boolean;
  sortOrder: number;
  groupIds: string[];
};

export type EditorCategory = {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
};

export type EditorData = {
  categories: EditorCategory[];
  items: EditorItem[];
  groups: EditorGroup[];
};

export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function inputToCents(value: string): number | null {
  const s = value
    .replace(/[’' ]/g, "")
    .replace(",", ".")
    .replace(/[.,]-+$/, "")
    .replace(/^CHF/i, "")
    .trim();
  if (s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
