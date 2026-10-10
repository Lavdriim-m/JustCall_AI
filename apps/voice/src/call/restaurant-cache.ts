import type { MenuSnapshot, RestaurantProfile } from "@justcall/core";
import {
  getRestaurant,
  loadMenuSnapshot,
  toRestaurantProfile,
  type Database,
  type Restaurant,
} from "@justcall/db";

export type RestaurantBundle = {
  row: Restaurant;
  profile: RestaurantProfile;
  menu: MenuSnapshot;
  /** Words used to boost speech recognition. */
  phrases: string[];
  loadedAt: number;
};

/**
 * Short-lived cache so that 20–50 simultaneous calls to the same restaurant do not each load the
 * full menu. Menu edits become visible within `ttlMs` (or immediately via invalidate()).
 */
export class RestaurantCache {
  private readonly entries = new Map<string, Promise<RestaurantBundle | null>>();
  private readonly timestamps = new Map<string, number>();

  constructor(
    private readonly db: Database,
    private readonly ttlMs = 30_000,
  ) {}

  get(restaurantId: string): Promise<RestaurantBundle | null> {
    const ts = this.timestamps.get(restaurantId) ?? 0;
    if (Date.now() - ts > this.ttlMs) this.entries.delete(restaurantId);
    let entry = this.entries.get(restaurantId);
    if (!entry) {
      entry = this.load(restaurantId).catch((err) => {
        this.entries.delete(restaurantId);
        throw err;
      });
      this.entries.set(restaurantId, entry);
      this.timestamps.set(restaurantId, Date.now());
    }
    return entry;
  }

  invalidate(restaurantId?: string) {
    if (restaurantId) {
      this.entries.delete(restaurantId);
      this.timestamps.delete(restaurantId);
    } else {
      this.entries.clear();
      this.timestamps.clear();
    }
  }

  private async load(restaurantId: string): Promise<RestaurantBundle | null> {
    const row = await getRestaurant(this.db, restaurantId);
    if (!row) return null;
    const menu = await loadMenuSnapshot(this.db, restaurantId);
    const phrases = new Set<string>();
    for (const item of menu.items) {
      phrases.add(item.name);
      for (const a of item.aliases) phrases.add(a);
    }
    for (const g of menu.groups) for (const o of g.options) phrases.add(o.name);
    phrases.add(row.name);
    return {
      row,
      profile: toRestaurantProfile(row),
      menu,
      phrases: [...phrases],
      loadedAt: Date.now(),
    };
  }
}
