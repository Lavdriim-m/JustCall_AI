/**
 * Menu snapshot used by the conversation engine. It is decoupled from the database rows so the
 * engine can be tested and reused independently (voice server, simulator, evaluation harness).
 */

export type MenuCategorySnap = {
  id: string;
  name: string;
  description?: string | null;
  sortOrder: number;
};

export type MenuOptionSnap = {
  id: string;
  name: string;
  aliases: string[];
  priceDeltaCents: number;
  isDefault: boolean;
  isAvailable: boolean;
  sortOrder: number;
};

export type OptionGroupSnap = {
  id: string;
  name: string;
  description?: string | null;
  /** 0 = optional, >= 1 = the caller has to choose at least this many. */
  minSelect: number;
  /** Maximum number of options from this group. */
  maxSelect: number;
  sortOrder: number;
  options: MenuOptionSnap[];
};

export type MenuItemSnap = {
  id: string;
  categoryId: string | null;
  name: string;
  description?: string | null;
  code?: string | null;
  aliases: string[];
  priceCents: number;
  tags: string[];
  isAvailable: boolean;
  sortOrder: number;
  /** Option groups attached to this item, in display order. */
  groupIds: string[];
};

export type MenuSnapshot = {
  categories: MenuCategorySnap[];
  items: MenuItemSnap[];
  groups: OptionGroupSnap[];
};
