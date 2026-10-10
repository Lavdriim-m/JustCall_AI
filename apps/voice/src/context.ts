import type { Database } from "@justcall/db";
import type { Config } from "./config";
import type { Logger } from "./logger";
import type { CallSession } from "./call/session";
import type { RestaurantCache } from "./call/restaurant-cache";

/** Keeps track of live calls (metrics, graceful shutdown). */
export class CallRegistry {
  private readonly sessions = new Map<string, CallSession>();
  add(id: string, s: CallSession) {
    this.sessions.set(id, s);
  }
  remove(id: string) {
    this.sessions.delete(id);
  }
  get size() {
    return this.sessions.size;
  }
  ids() {
    return [...this.sessions.keys()];
  }
  async stopAll(reason: string) {
    await Promise.allSettled([...this.sessions.values()].map((s) => s.onStop(reason)));
    this.sessions.clear();
  }
}

export type AppContext = {
  config: Config;
  db: Database;
  logger: Logger;
  restaurants: RestaurantCache;
  registry: CallRegistry;
};
